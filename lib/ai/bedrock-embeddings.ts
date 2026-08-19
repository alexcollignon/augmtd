/**
 * Bedrock Embeddings — the `embeddings.create()` half of the Bedrock adapter.
 *
 * THE PRIVACY PREMISE (Aug 19): no prompt, and no DOCUMENT, leaves the private perimeter. Embeddings
 * were the one task still routed to a third-party host (Together AI) on every private tier — every
 * KB chunk, every entity summary, every recognised item body went out to be vectorised. This module
 * moves that work onto AWS Bedrock (EU region, SigV4, the same perimeter the completions already use).
 *
 * Model: Cohere Embed Multilingual v3 — the owner's call (Aug 19): the corpus is EN/PT/DE/FR and
 * Titan's multilingual quality is weak; NEVER Titan. 1024 dims (matches the pgvector columns exactly —
 * no schema change), up to 96 texts per call, 512-token input per text (server-side `truncate: END`).
 *
 * Cohere is ASYMMETRIC: documents embed as `search_document`, queries as `search_query`. The OpenAI
 * contract has no such field, so callers pass an extra `input_type` and the indexer's `embedText`
 * derives it from a `purpose` ('document' | 'query'); absent → document (the safe default — a stored
 * vector is always a document).
 *
 * Duck-typed to the OpenAI `embeddings.create` contract so every consumer keeps calling
 * `client.embeddings.create({ model, input, ... })` unchanged:
 * returns `{ data:[{index, embedding}], usage:{prompt_tokens,total_tokens}, model }`.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

export const BEDROCK_EMBEDDING_MODEL = 'cohere.embed-multilingual-v3'
export const BEDROCK_EMBEDDING_DIMENSIONS = 1024

export type EmbeddingInputType = 'search_document' | 'search_query' | 'classification' | 'clustering'

// Cohere: ≤96 texts per InvokeModel call; 512 tokens per text (truncate END cuts the tail server-side
// — the caller already clips well below that, so nothing load-bearing is ever lost silently).
const COHERE_BATCH = 96
const COHERE_MAX_INPUT_CHARS = 4_000
const POOL = 4

interface EmbedConfig {
  awsRegion: string
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
}

export interface BedrockEmbeddingsAPI {
  create: (params: {
    model: string
    input: string | string[]
    dimensions?: number
    input_type?: EmbeddingInputType
    [k: string]: unknown
  }) => Promise<{
    object: 'list'
    data: Array<{ object: 'embedding'; index: number; embedding: number[] }>
    model: string
    usage: { prompt_tokens: number; total_tokens: number }
  }>
}

export function createBedrockEmbeddings(config: EmbedConfig): BedrockEmbeddingsAPI {
  const client = new BedrockRuntimeClient({
    region: config.awsRegion,
    ...(config.awsAccessKey && config.awsSecretKey
      ? {
          credentials: {
            accessKeyId: config.awsAccessKey,
            secretAccessKey: config.awsSecretKey,
            ...(config.awsSessionToken ? { sessionToken: config.awsSessionToken } : {}),
          },
        }
      : {}),
  })

  async function embedBatch(modelId: string, texts: string[], inputType: EmbeddingInputType, dimensions: number): Promise<number[][]> {
    // Cohere rejects an empty string — a blank input still yields a (meaningless but well-formed)
    // vector so a caller embedding an empty summary never crashes an indexing run.
    const body = {
      texts: texts.map((t) => (t && t.trim() ? t : ' ').slice(0, COHERE_MAX_INPUT_CHARS)),
      input_type: inputType,
      truncate: 'END',
    }
    const res = await client.send(new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }))
    const json = JSON.parse(new TextDecoder().decode(res.body)) as { embeddings?: number[][] | { float?: number[][] } }
    const vectors = Array.isArray(json.embeddings) ? json.embeddings : json.embeddings?.float
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error(`[BedrockEmbeddings] ${modelId} returned ${vectors?.length ?? 'no'} vectors for ${texts.length} texts`)
    }
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== dimensions) {
        throw new Error(`[BedrockEmbeddings] ${modelId} returned ${v?.length ?? 'no'} dims (expected ${dimensions})`)
      }
    }
    return vectors
  }

  return {
    async create(params) {
      const inputs = Array.isArray(params.input) ? params.input : [params.input]
      const dimensions = params.dimensions ?? BEDROCK_EMBEDDING_DIMENSIONS
      if (dimensions !== BEDROCK_EMBEDDING_DIMENSIONS) {
        throw new Error(`[BedrockEmbeddings] ${BEDROCK_EMBEDDING_MODEL} is fixed at ${BEDROCK_EMBEDDING_DIMENSIONS} dims (asked ${dimensions})`)
      }
      const modelId = params.model || BEDROCK_EMBEDDING_MODEL
      const inputType: EmbeddingInputType = params.input_type ?? 'search_document'

      const batches: Array<{ start: number; texts: string[] }> = []
      for (let i = 0; i < inputs.length; i += COHERE_BATCH) batches.push({ start: i, texts: inputs.slice(i, i + COHERE_BATCH) })

      const out: number[][] = new Array(inputs.length)
      let cursor = 0
      const worker = async () => {
        while (true) {
          const b = batches[cursor++]
          if (!b) return
          const vecs = await embedBatch(modelId, b.texts, inputType, dimensions)
          vecs.forEach((v, j) => { out[b.start + j] = v })
        }
      }
      await Promise.all(Array.from({ length: Math.min(POOL, batches.length) }, worker))

      // Cohere-on-Bedrock returns no token count — an ESTIMATE (≈4 chars/token) feeds the cost log,
      // which is itself declared approximate (lib/ai/pricing.ts). Never presented as measured.
      const promptTokens = inputs.reduce((s, t) => s + Math.ceil(Math.min(t?.length ?? 0, COHERE_MAX_INPUT_CHARS) / 4), 0)
      return {
        object: 'list',
        data: out.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        model: modelId,
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      }
    },
  }
}
