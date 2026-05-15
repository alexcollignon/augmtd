// ─── Portuguese Public Procurement tool (Portal Base / IMPIC) ────────────────
// Calls the Base.gov.pt APIBase2 to retrieve recently awarded contracts
// and open procurement announcements.
//
// Auth: PORTAL_BASE_TOKEN env var  (header: _AcessToken)
// Docs: https://www.base.gov.pt/APIBase2

const BASE_URL = 'https://www.base.gov.pt/APIBase2';
const MAX_DAYS = 90;
const MAX_ITEMS = 30;

// ── Actual response shapes (verified against live API) ────────────────────────

interface BaseContract {
  idcontrato?: string;
  objectoContrato?: string;
  descContrato?: string;
  adjudicante?: string[];       // ["NIF - Entity name"]
  adjudicatarios?: string[];
  dataPublicacao?: string;
  dataCelebracaoContrato?: string;
  precoContratual?: number;     // numeric, e.g. 198999.99
  precoBaseProcedimento?: number;
  PrecoTotalEfetivo?: number;
  cpv?: string[];
  prazoExecucao?: number;       // days
  localExecucao?: string[];
  tipoprocedimento?: string;
  tipoContrato?: string[];
  Ano?: number;
}

interface BaseAnnouncement {
  nAnuncio?: string;
  IdIncm?: string;
  tipoActo?: string;            // "Anúncio de procedimento"
  descricaoAnuncio?: string;    // the tender title/description
  designacaoEntidade?: string;  // contracting entity name
  nifEntidade?: string;
  dataPublicacao?: string;
  PrecoBase?: string;           // string "9000.00"
  CPVs?: string[];              // capital, plural
  modeloAnuncio?: string;       // procedure type
  tiposContrato?: string[];     // plural
  PrazoPropostas?: number;      // days to submit
  DataLimitePropostas?: string; // deadline date
  url?: string;                 // link to DR publication
  PecasProcedimento?: string;   // link to tender docs
  Ano?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEur(value: number | string | undefined): string {
  if (value === undefined || value === null) return '';
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (isNaN(n) || n === 0) return '';
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function joinArr(arr: string[] | undefined): string {
  return (arr ?? []).filter(Boolean).join('; ');
}

// Strip NIF prefix from entity strings like "600010180 - ESTADO-MAIOR..."
function stripNif(s: string): string {
  return s.replace(/^\d{9}\s*-\s*/, '');
}

function formatEntityArr(arr: string[] | undefined): string {
  return (arr ?? []).map(stripNif).filter(Boolean).join('; ');
}

function formatContract(c: BaseContract, idx: number): string {
  const value = formatEur(c.precoContratual);
  const lines: string[] = [
    `### ${idx + 1}. ${c.objectoContrato ?? '(sem título)'}`,
    `- **Adjudicante:** ${formatEntityArr(c.adjudicante) || '—'}`,
    `- **Adjudicatário:** ${formatEntityArr(c.adjudicatarios) || '—'}`,
    `- **Valor:** ${value || '—'}`,
    `- **Data contrato:** ${c.dataCelebracaoContrato ?? c.dataPublicacao ?? '—'}`,
    `- **CPV:** ${joinArr(c.cpv) || '—'}`,
    `- **Local:** ${joinArr(c.localExecucao) || '—'}`,
    `- **Prazo execução:** ${c.prazoExecucao ? `${c.prazoExecucao} dias` : '—'}`,
    `- **Procedimento:** ${c.tipoprocedimento ?? '—'}`,
  ];
  return lines.join('\n');
}

function formatAnnouncement(a: BaseAnnouncement, idx: number): string {
  const value = formatEur(a.PrecoBase);
  const deadline = a.DataLimitePropostas && a.DataLimitePropostas !== ''
    ? a.DataLimitePropostas
    : (a.PrazoPropostas ? `${a.PrazoPropostas} dias` : '—');
  const lines: string[] = [
    `### ${idx + 1}. ${a.descricaoAnuncio ?? '(sem título)'}`,
    `- **Entidade:** ${a.designacaoEntidade ?? '—'}`,
    `- **Tipo:** ${a.modeloAnuncio ?? a.tipoActo ?? '—'}`,
    `- **Base:** ${value || '—'}`,
    `- **Publicação:** ${a.dataPublicacao ?? '—'}  |  **Limite propostas:** ${deadline}`,
    `- **CPV:** ${joinArr(a.CPVs) || '—'}`,
    `- **Contrato:** ${joinArr(a.tiposContrato) || '—'}`,
    ...(a.url ? [`- **Anúncio:** ${a.url}`] : []),
    ...(a.PecasProcedimento ? [`- **Documentos:** ${a.PecasProcedimento}`] : []),
  ];
  return lines.join('\n');
}

async function callApi<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T[]> {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { '_AcessToken': token },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Portal Base API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (typeof data === 'string') throw new Error(`Portal Base: ${data}`);
  return (Array.isArray(data) ? data : [data]) as T[];
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PtTendersConfig {
  days?: number;
  endpoint?: 'contracts' | 'announcements' | 'both';
  cpv_prefix?: string;
  min_value?: number;
}

export async function executePtTenders(config: Record<string, unknown>): Promise<string> {
  const token = process.env.PORTAL_BASE_TOKEN;
  if (!token) return '[pt_tenders] PORTAL_BASE_TOKEN env var is not set.';

  const days = Math.min(typeof config.days === 'number' ? config.days : 7, MAX_DAYS);
  const endpoint = (config.endpoint as string) ?? 'both';
  const cpvPrefix = typeof config.cpv_prefix === 'string' ? config.cpv_prefix : undefined;
  const minValue = typeof config.min_value === 'number' ? config.min_value : undefined;

  const params: Record<string, string> = { numDias: String(days) };
  if (cpvPrefix) params.CPV = cpvPrefix;

  const sections: string[] = [];

  // ── Contracts ───────────────────────────────────────────────────────────────
  if (endpoint === 'contracts' || endpoint === 'both') {
    try {
      let contracts = await callApi<BaseContract>('GetInfoContrato', params, token);

      if (minValue !== undefined) {
        contracts = contracts.filter(c => (c.precoContratual ?? 0) >= minValue);
      }

      contracts = contracts.slice(0, MAX_ITEMS);

      if (contracts.length === 0) {
        sections.push(`## Contratos Adjudicados (últimos ${days} dias)\n\nNenhum contrato encontrado com os critérios definidos.`);
      } else {
        sections.push(
          `## Contratos Adjudicados (últimos ${days} dias) — ${contracts.length} encontrado${contracts.length !== 1 ? 's' : ''}`,
          ...contracts.map((c, i) => formatContract(c, i)),
        );
      }
    } catch (err) {
      sections.push(`## Contratos Adjudicados\n\n[Erro: ${err instanceof Error ? err.message : String(err)}]`);
    }
  }

  // ── Announcements ────────────────────────────────────────────────────────────
  if (endpoint === 'announcements' || endpoint === 'both') {
    try {
      let announcements = await callApi<BaseAnnouncement>('GetInfoAnuncio', params, token);

      if (minValue !== undefined) {
        announcements = announcements.filter(a => {
          const v = parseFloat((a.PrecoBase ?? '0').replace(',', '.'));
          return !isNaN(v) && v >= minValue;
        });
      }

      announcements = announcements.slice(0, MAX_ITEMS);

      if (announcements.length === 0) {
        sections.push(`## Anúncios de Procedimento (últimos ${days} dias)\n\nNenhum anúncio encontrado com os critérios definidos.`);
      } else {
        sections.push(
          `## Anúncios de Procedimento (últimos ${days} dias) — ${announcements.length} encontrado${announcements.length !== 1 ? 's' : ''}`,
          ...announcements.map((a, i) => formatAnnouncement(a, i)),
        );
      }
    } catch (err) {
      sections.push(`## Anúncios de Procedimento\n\n[Erro: ${err instanceof Error ? err.message : String(err)}]`);
    }
  }

  return sections.join('\n\n');
}
