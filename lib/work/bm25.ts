export interface DocumentChunk {
  index: number;
  text: string;
  source: string; // filename the chunk came from
}

export interface AttachmentContextBundle {
  flat: string;
  chunks: DocumentChunk[] | null; // null when chunkedRetrieval is off
}

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','is','it',
  'that','this','for','with','as','at','by','from','on',
  'be','are','was','were','i','we','you','he','she','they',
  'have','has','had','will','would','could','should','may',
  'might','do','did','does','not','no','but','if','so',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function buildFreqMap(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

/**
 * Split flat attachment context text into overlapping chunks.
 * Preserves per-file source tags from the "--- filename ---" delimiters
 * that buildSmartAttachmentContext injects.
 */
export function chunkText(
  flat: string,
  chunkSize = 3200,
  overlap = 200,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  // Split on file-level delimiters first
  const parts = flat.split(/(?=^--- .+ ---$)/m);
  const fileBlocks: Array<{ source: string; content: string }> = [];

  for (const part of parts) {
    const match = part.match(/^--- (.+?) ---\n?([\s\S]*)/m);
    if (match) {
      fileBlocks.push({ source: match[1].trim(), content: match[2] ?? '' });
    } else if (part.trim()) {
      fileBlocks.push({ source: 'document', content: part });
    }
  }

  // If no delimiters found, treat the whole string as one file block
  if (fileBlocks.length === 0 && flat.trim()) {
    fileBlocks.push({ source: 'document', content: flat });
  }

  const stride = chunkSize - overlap;
  for (const { source, content } of fileBlocks) {
    let pos = 0;
    while (pos < content.length) {
      const slice = content.slice(pos, pos + chunkSize);
      if (slice.trim().length > 50) {
        chunks.push({ index: chunkIndex++, text: slice, source });
      }
      pos += stride;
    }
  }

  return chunks;
}

/**
 * BM25 retrieval: returns the top-n most relevant chunks for a query.
 * Uses Okapi BM25 with k1=1.5, b=0.75.
 * Returns chunks in original document order (not score order) for coherent reading.
 */
export function topNChunks(
  query: string,
  chunks: DocumentChunk[],
  n: number,
): DocumentChunk[] {
  if (chunks.length === 0) return [];
  if (chunks.length <= n) return chunks;

  const K1 = 1.5;
  const B = 0.75;

  const tokenizedChunks = chunks.map((c) => tokenize(c.text));
  const avgDocLen =
    tokenizedChunks.reduce((sum, t) => sum + t.length, 0) / tokenizedChunks.length;

  const qTerms = Array.from(new Set(tokenize(query)));
  if (qTerms.length === 0) return chunks.slice(0, n);

  // IDF for each query term
  const N = chunks.length;
  const idf = new Map<string, number>();
  for (const term of qTerms) {
    const df = tokenizedChunks.filter((tokens) => tokens.includes(term)).length;
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }

  // Score each chunk
  const scores = tokenizedChunks.map((tokens, idx) => {
    const freq = buildFreqMap(tokens);
    const docLen = tokens.length;
    let score = 0;
    for (const term of qTerms) {
      const tf = freq.get(term) ?? 0;
      if (tf === 0) continue;
      const termIdf = idf.get(term) ?? 0;
      score +=
        termIdf *
        ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * docLen) / avgDocLen)));
    }
    return { idx, score };
  });

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.idx - b.idx) // restore document order for coherent reading
    .map(({ idx }) => chunks[idx]);
}
