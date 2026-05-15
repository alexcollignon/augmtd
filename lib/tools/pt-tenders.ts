// ─── Portuguese Public Procurement tool (Portal Base / IMPIC) ────────────────
// Calls the Base.gov.pt APIBase2 to retrieve recently awarded contracts
// and open procurement announcements.
//
// Auth: PORTAL_BASE_TOKEN env var  (header: _AcessToken)
// Docs: https://www.base.gov.pt/APIBase2
//
// Endpoints used:
//   GET /GetInfoContrato?numDias=N   — contracts signed in the last N days
//   GET /GetInfoAnuncio?numDias=N    — open tender announcements in last N days

const BASE_URL = 'https://www.base.gov.pt/APIBase2';
const MAX_DAYS = 90;
const MAX_ITEMS = 30; // cap returned rows per endpoint to keep output manageable

// ── Response shapes (partial — only fields we surface) ────────────────────────

interface BaseContract {
  idContrato?: string;
  objectoContrato?: string;
  descContrato?: string;
  adjudicante?: string[];
  adjudicatarios?: string[];
  dataPublicacao?: string;
  dataCelebracaoContrato?: string;
  precoContratual?: string;
  precoBaseProcedimento?: string;
  cpv?: string[];
  prazoExecucao?: string;
  localExecucao?: string[];
  tipoprocedimento?: string;
  tipoContrato?: string[];
  Ano?: string;
}

interface BaseAnnouncement {
  nAnuncio?: string;
  TipoAnuncio?: string;
  objectoContrato?: string;
  adjudicante?: string[];
  dataPublicacao?: string;
  precoBaseProcedimento?: string;
  cpv?: string[];
  prazoExecucao?: string;
  localExecucao?: string[];
  tipoprocedimento?: string;
  tipoContrato?: string[];
  Ano?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEur(raw: string | undefined): string {
  if (!raw) return '';
  const n = parseFloat(raw.replace(',', '.'));
  if (isNaN(n)) return raw;
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function joinArr(arr: string[] | undefined): string {
  return (arr ?? []).filter(Boolean).join('; ');
}

function formatContract(c: BaseContract, idx: number): string {
  const lines: string[] = [
    `### ${idx + 1}. ${c.objectoContrato ?? '(sem título)'}`,
    `- **Adjudicante:** ${joinArr(c.adjudicante) || '—'}`,
    `- **Adjudicatário:** ${joinArr(c.adjudicatarios) || '—'}`,
    `- **Valor contratual:** ${formatEur(c.precoContratual) || '—'}`,
    `- **Publicação:** ${c.dataPublicacao ?? '—'}  |  **Celebração:** ${c.dataCelebracaoContrato ?? '—'}`,
    `- **CPV:** ${joinArr(c.cpv) || '—'}`,
    `- **Local:** ${joinArr(c.localExecucao) || '—'}`,
    `- **Prazo:** ${c.prazoExecucao ? `${c.prazoExecucao} dias` : '—'}`,
    `- **Procedimento:** ${c.tipoprocedimento ?? '—'}`,
  ];
  return lines.join('\n');
}

function formatAnnouncement(a: BaseAnnouncement, idx: number): string {
  const lines: string[] = [
    `### ${idx + 1}. ${a.objectoContrato ?? '(sem título)'}`,
    `- **Anúncio nº:** ${a.nAnuncio ?? '—'}  |  **Tipo:** ${a.TipoAnuncio ?? '—'}`,
    `- **Entidade:** ${joinArr(a.adjudicante) || '—'}`,
    `- **Base:** ${formatEur(a.precoBaseProcedimento) || '—'}`,
    `- **Publicação:** ${a.dataPublicacao ?? '—'}`,
    `- **CPV:** ${joinArr(a.cpv) || '—'}`,
    `- **Local:** ${joinArr(a.localExecucao) || '—'}`,
    `- **Procedimento:** ${a.tipoprocedimento ?? '—'}`,
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
  // API returns either an array or a single object or an error string
  if (typeof data === 'string') throw new Error(`Portal Base: ${data}`);
  return (Array.isArray(data) ? data : [data]) as T[];
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PtTendersConfig {
  /** How many days back to fetch. Default 7, max 90. */
  days?: number;
  /** Which endpoint to query. Default 'both'. */
  endpoint?: 'contracts' | 'announcements' | 'both';
  /** Optional CPV code prefix filter (e.g. "45" = construction, "72" = IT). */
  cpv_prefix?: string;
  /** Optional minimum contract value in EUR. */
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
        contracts = contracts.filter(c => {
          const v = parseFloat((c.precoContratual ?? '0').replace(',', '.'));
          return !isNaN(v) && v >= minValue;
        });
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
          const v = parseFloat((a.precoBaseProcedimento ?? '0').replace(',', '.'));
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
