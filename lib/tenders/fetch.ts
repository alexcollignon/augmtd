// ─── BASE.gov.pt structured reader — ONE FETCH, TWO CONSUMERS ────────────────────────────────
// The single structured read of the Portal Base APIBase2 announcement/contract lanes.
// Both the briefing formatter (`lib/tools/pt-tenders.ts`) and the member matcher consume THESE
// rows, so what the briefing prints and what the matcher saw can never drift
// (docs/ahk-tender-matching-plan.md, law 5).
//
// Pure fetch + shape: no AI, no database, no side effects. Presentation decisions (stripping the
// NIF for display, sector wording, item caps) belong to the consumer, never here.
//
// Auth: PORTAL_BASE_TOKEN env var (header: _AcessToken). Docs: https://www.base.gov.pt/APIBase2

const BASE_URL = 'https://www.base.gov.pt/APIBase2';
const DR_FILES = 'https://files.diariodarepublica.pt';

export const TENDERS_MAX_DAYS = 90;
const ANNOUNCEMENTS_TIMEOUT_MS = 30_000;
// The contracts lane is flaky live (empty bodies, 30s hangs observed in the same session the
// announcements lane answered in <1s) — it gets a short leash and never blocks the caller.
const CONTRACTS_TIMEOUT_MS = 12_000;

// ── Raw response shapes (verified against the live API) ───────────────────────────────────────

interface RawAnnouncement {
  nAnuncio?: string;
  IdIncm?: string;
  tipoActo?: string;
  descricaoAnuncio?: string;
  designacaoEntidade?: string;
  nifEntidade?: string;
  dataPublicacao?: string;
  PrecoBase?: string;
  CPVs?: string[];
  modeloAnuncio?: string;
  tiposContrato?: string[];
  PrazoPropostas?: number;
  DataLimitePropostas?: string;
  url?: string;
  PecasProcedimento?: string;
  Lotes?: string[];
  CriterAmbient?: string;
  numDR?: string;
  serie?: string;
  Ano?: number;
}

interface RawContract {
  idcontrato?: string;
  objectoContrato?: string;
  descContrato?: string;
  adjudicante?: string[];
  adjudicatarios?: string[];
  dataPublicacao?: string;
  dataCelebracaoContrato?: string;
  precoContratual?: number;
  precoBaseProcedimento?: number;
  PrecoTotalEfetivo?: number;
  cpv?: string[];
  prazoExecucao?: number;
  localExecucao?: string[];
  tipoprocedimento?: string;
  tipoContrato?: string[];
  Ano?: number;
}

// ── Typed rows ────────────────────────────────────────────────────────────────────────────────

export interface TenderCpv {
  /** "45113000-2" */
  code: string;
  /** The API's own Portuguese label, e.g. "Obras no local". */
  label: string;
  /** The two-digit CPV division ("45") — the deterministic sector key. */
  division: string;
}

export interface TenderAnnouncement {
  /** Stable across runs and lanes: the announcement number plus the INCM publication id. */
  id: string;
  nAnuncio: string;
  idIncm: string;

  tipoActo: string;
  /** tipoActo names an "Anúncio de Alteração" — an amendment, never a new opportunity. */
  isAmendment: boolean;
  /** On a base row: how many amendments in the same window amend it. */
  amendments: number;

  /** The contracting authority, NIF kept — the clean join key to any company register. */
  entityName: string;
  entityNif: string;

  description: string;
  cpvs: TenderCpv[];
  contractTypes: string[];
  /** modeloAnuncio — "Concurso público" etc. */
  procedureType: string;
  lots: string[];
  environmentalCriteria: boolean;

  /** PrecoBase parsed. The literal "Inexistente" and anything unparseable → null, NEVER NaN. */
  value: number | null;
  valueRaw: string;
  /** The authority published no base price. The consumer decides — it is not a zero. */
  valueUnknown: boolean;

  publishedAt: Date | null;
  publishedRaw: string;
  deadline: Date | null;
  deadlineRaw: string;
  /** The deadline was computed from PrazoPropostas + publication date, not published outright. */
  deadlineDerived: boolean;
  proposalDays: number | null;

  /** The Diário da República PDF — the legal publication. Echoed, else reconstructed. */
  officialUrl: string | null;
  /** PecasProcedimento — the e-procurement platform's "go bid" door. */
  platformUrl: string | null;

  numDR: string;
  serie: string;
  year: number | null;
}

export interface TenderContract {
  id: string;
  title: string;
  description: string;
  /** Verbatim "NIF - Name" strings; splitting them is presentation. */
  buyers: string[];
  suppliers: string[];
  value: number | null;
  basePrice: number | null;
  cpvs: TenderCpv[];
  signedAt: Date | null;
  signedRaw: string;
  publishedAt: Date | null;
  publishedRaw: string;
  executionDays: number | null;
  places: string[];
  procedureType: string;
  contractTypes: string[];
  year: number | null;
}

export interface FetchAnnouncementsOptions {
  /** Code-side window in days (clamped to 90). Default 7. */
  days?: number;
  /** Sent as the API's `CPV` param — server-side, single-valued (no OR). */
  cpvPrefix?: string;
  /** Client-side floor. A value-unknown row PASSES it, flagged — the consumer decides. */
  minValue?: number;
  /** Return amendment rows as typed rows too, instead of folding them into their base. */
  includeAmendments?: boolean;
  token?: string;
}

export interface AnnouncementsResult {
  rows: TenderAnnouncement[];
  days: number;
  /** How many rows the API handed back before any code-side filtering. */
  apiCount: number;
  /** How many survived the code-side day window. */
  inWindowCount: number;
  /** Amendments folded out of the listing (base rows carry them as `amendments`). */
  amendmentsFolded: number;
  /** Folded amendments whose base announcement was published outside this window. */
  amendmentsOrphaned: number;
  /** Base rows dropped by minValue. Value-unknown rows are never counted here. */
  belowFloor: number;
  /** Rows that passed the floor only because their value is unpublished. */
  valueUnknownCount: number;
}

export interface ContractsResult {
  rows: TenderContract[];
  apiCount: number;
  /** The lane timed out, errored, or answered empty — best-effort, never thrown. */
  contractsUnavailable: boolean;
  unavailableReason?: string;
}

// ── Parsing ───────────────────────────────────────────────────────────────────────────────────

/** Portal Base dates are DD/MM/YYYY. */
export function parsePtDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ⚠️ The APIBase2 `numDias` parameter is NOT reliable — observed live returning 7,991 rows dating
// back to 2014 (oldest first) for numDias=7, and 0 rows minutes later. Slicing that blindly fed
// decade-old records into client briefings labeled "last 7 days". The window is therefore enforced
// CODE-SIDE, on the row's own dates; numDias rides along only as a hint to the server.
function inWindow(date: Date | null, days: number): boolean {
  if (!date) return false; // an undated row can't prove freshness — excluded
  return Date.now() - date.getTime() <= days * 86_400_000 && date.getTime() <= Date.now() + 86_400_000;
}

/** ⚠️ PrecoBase is a STRING and can literally be "Inexistente" (the authority published no base
 *  price). parseFloat makes that NaN, and a NaN comparison silently drops the row from every
 *  value filter — the tender disappears rather than being reviewed. Unparseable → null. */
function parsePrice(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s || !/\d/.test(s)) return null;
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

/** CPV strings arrive as "45113000-2 - Obras no local". */
function parseCpvs(arr: string[] | undefined): TenderCpv[] {
  return (arr ?? []).filter(Boolean).map((raw) => {
    const m = String(raw).trim().match(/^(\d{2,8}(?:-\d)?)\s*-\s*(.*)$/);
    const code = m ? m[1] : String(raw).trim();
    return { code, label: m ? m[2].trim() : '', division: code.slice(0, 2) };
  });
}

export function cpvDivisionsOf(row: TenderAnnouncement): string[] {
  return Array.from(new Set(row.cpvs.map((c) => c.division).filter(Boolean)));
}

function isAmendmentAct(tipoActo: string | undefined): boolean {
  return /altera/i.test(tipoActo ?? '');
}

/** The DR PDF is 100% present in practice, and reconstructible when it is not:
 *  /cp_hora/{YYYY}/{MM}/{numDR}/{IdIncm}.pdf (verified 200, application/pdf). */
function officialUrlOf(r: RawAnnouncement, published: Date | null): string | null {
  const echoed = (r.url ?? '').trim();
  if (echoed) return echoed;
  if (!r.IdIncm || !r.numDR || !published) return null;
  const yyyy = String(published.getUTCFullYear());
  const mm = String(published.getUTCMonth() + 1).padStart(2, '0');
  return `${DR_FILES}/cp_hora/${yyyy}/${mm}/${r.numDR}/${r.IdIncm}.pdf`;
}

/** The identity an amendment shares with the announcement it amends. The APIBase2 gives an
 *  amendment its OWN nAnuncio and IdIncm (verified live), so the fold key is the procedure it
 *  points at: the e-procurement link when present, else authority NIF + object text. */
function foldKeysOf(r: RawAnnouncement): string[] {
  const keys: string[] = [];
  const pecas = (r.PecasProcedimento ?? '').trim();
  if (pecas) keys.push(`p:${pecas}`);
  const desc = (r.descricaoAnuncio ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (desc) keys.push(`e:${(r.nifEntidade ?? '').trim()}|${desc}`);
  return keys;
}

function shapeAnnouncement(r: RawAnnouncement): TenderAnnouncement {
  const published = parsePtDate(r.dataPublicacao);
  const value = parsePrice(r.PrecoBase);
  const proposalDays = typeof r.PrazoPropostas === 'number' && r.PrazoPropostas > 0 ? r.PrazoPropostas : null;

  let deadline = parsePtDate(r.DataLimitePropostas);
  let deadlineDerived = false;
  if (!deadline && published && proposalDays) {
    deadline = new Date(published.getTime() + proposalDays * 86_400_000);
    deadlineDerived = true;
  }

  const nAnuncio = (r.nAnuncio ?? '').trim();
  const idIncm = (r.IdIncm ?? '').trim();

  return {
    id: `${nAnuncio}::${idIncm}`,
    nAnuncio,
    idIncm,
    tipoActo: (r.tipoActo ?? '').trim(),
    isAmendment: isAmendmentAct(r.tipoActo),
    amendments: 0,
    entityName: (r.designacaoEntidade ?? '').trim(),
    entityNif: (r.nifEntidade ?? '').trim(),
    description: (r.descricaoAnuncio ?? '').trim(),
    cpvs: parseCpvs(r.CPVs),
    contractTypes: (r.tiposContrato ?? []).filter(Boolean),
    procedureType: (r.modeloAnuncio ?? '').trim(),
    lots: (r.Lotes ?? []).filter(Boolean),
    environmentalCriteria: /^sim$/i.test((r.CriterAmbient ?? '').trim()),
    value,
    valueRaw: (r.PrecoBase ?? '').trim(),
    valueUnknown: value === null,
    publishedAt: published,
    publishedRaw: (r.dataPublicacao ?? '').trim(),
    deadline,
    deadlineRaw: (r.DataLimitePropostas ?? '').trim(),
    deadlineDerived,
    proposalDays,
    officialUrl: officialUrlOf(r, published),
    platformUrl: (r.PecasProcedimento ?? '').trim() || null,
    numDR: (r.numDR ?? '').trim(),
    serie: (r.serie ?? '').trim(),
    year: typeof r.Ano === 'number' ? r.Ano : null,
  };
}

function shapeContract(r: RawContract): TenderContract {
  return {
    id: (r.idcontrato ?? '').trim(),
    title: (r.objectoContrato ?? '').trim(),
    description: (r.descContrato ?? '').trim(),
    buyers: (r.adjudicante ?? []).filter(Boolean),
    suppliers: (r.adjudicatarios ?? []).filter(Boolean),
    value: parsePrice(r.precoContratual),
    basePrice: parsePrice(r.precoBaseProcedimento),
    cpvs: parseCpvs(r.cpv),
    signedAt: parsePtDate(r.dataCelebracaoContrato),
    signedRaw: (r.dataCelebracaoContrato ?? '').trim(),
    publishedAt: parsePtDate(r.dataPublicacao),
    publishedRaw: (r.dataPublicacao ?? '').trim(),
    executionDays: typeof r.prazoExecucao === 'number' ? r.prazoExecucao : null,
    places: (r.localExecucao ?? []).filter(Boolean),
    procedureType: (r.tipoprocedimento ?? '').trim(),
    contractTypes: (r.tipoContrato ?? []).filter(Boolean),
    year: typeof r.Ano === 'number' ? r.Ano : null,
  };
}

// ── Transport ─────────────────────────────────────────────────────────────────────────────────

async function callApi<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  timeoutMs: number,
): Promise<T[]> {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // The API is intermittently flaky (observed live: the announcements lane timing out for a
  // minute, then answering in <1s) — one retry after a short pause before an honest failure,
  // so a flaky minute never empties a weekly deliverable's tender section.
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { '_AcessToken': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    res = await fetch(url.toString(), {
      headers: { '_AcessToken': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Portal Base API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  // The API answers a bare error STRING on bad params rather than a status code.
  if (typeof data === 'string') throw new Error(`Portal Base: ${data}`);
  return (Array.isArray(data) ? data : [data]) as T[];
}

function resolveToken(explicit?: string): string {
  const token = explicit ?? process.env.PORTAL_BASE_TOKEN;
  if (!token) throw new Error('PORTAL_BASE_TOKEN env var is not set.');
  return token;
}

export function clampDays(days: number | undefined): number {
  const d = typeof days === 'number' && isFinite(days) && days > 0 ? Math.floor(days) : 7;
  return Math.min(d, TENDERS_MAX_DAYS);
}

// ── Public API ────────────────────────────────────────────────────────────────────────────────

/**
 * The whole window, uncapped (any item cap is a RENDERING decision and lives in the consumer),
 * newest-first, amendments folded into the base announcement they amend.
 */
export async function fetchAnnouncements(
  opts: FetchAnnouncementsOptions = {},
): Promise<AnnouncementsResult> {
  const token = resolveToken(opts.token);
  const days = clampDays(opts.days);

  const params: Record<string, string> = { numDias: String(days) };
  if (opts.cpvPrefix) params.CPV = opts.cpvPrefix;

  const raw = await callApi<RawAnnouncement>('GetInfoAnuncio', params, token, ANNOUNCEMENTS_TIMEOUT_MS);
  const apiCount = raw.length;

  const windowed = raw.filter((r) => inWindow(parsePtDate(r.dataPublicacao), days));
  const inWindowCount = windowed.length;

  const shaped = windowed.map(shapeAnnouncement);
  const byFoldKey = new Map<string, TenderAnnouncement>();
  windowed.forEach((r, i) => {
    if (isAmendmentAct(r.tipoActo)) return;
    for (const k of foldKeysOf(r)) if (!byFoldKey.has(k)) byFoldKey.set(k, shaped[i]);
  });

  let amendmentsFolded = 0;
  let amendmentsOrphaned = 0;
  const amendmentRows: TenderAnnouncement[] = [];
  windowed.forEach((r, i) => {
    if (!isAmendmentAct(r.tipoActo)) return;
    amendmentsFolded++;
    amendmentRows.push(shaped[i]);
    const base = foldKeysOf(r).map((k) => byFoldKey.get(k)).find(Boolean);
    // An amendment to an announcement published before this window has no base row to carry it —
    // counted, never silently dropped.
    if (base) base.amendments++;
    else amendmentsOrphaned++;
  });

  let rows = shaped.filter((r) => !r.isAmendment);

  let belowFloor = 0;
  if (typeof opts.minValue === 'number') {
    const floor = opts.minValue;
    rows = rows.filter((r) => {
      if (r.value === null) return true; // value-unknown passes the floor, flagged
      if (r.value >= floor) return true;
      belowFloor++;
      return false;
    });
  }

  if (opts.includeAmendments) rows = rows.concat(amendmentRows);

  rows.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  return {
    rows,
    days,
    apiCount,
    inWindowCount,
    amendmentsFolded,
    amendmentsOrphaned,
    belowFloor,
    valueUnknownCount: rows.filter((r) => r.valueUnknown).length,
  };
}

/**
 * The awarded-contracts lane. Best-effort by design: the API answers `[]` after 30s as often as it
 * answers rows, so failure returns an empty result carrying `contractsUnavailable` — never a throw.
 */
export async function fetchContracts(
  opts: { days?: number; cpvPrefix?: string; minValue?: number; token?: string } = {},
): Promise<ContractsResult> {
  const days = clampDays(opts.days);
  let token: string;
  try {
    token = resolveToken(opts.token);
  } catch (err) {
    return { rows: [], apiCount: 0, contractsUnavailable: true, unavailableReason: String(err) };
  }

  const params: Record<string, string> = { numDias: String(days) };
  if (opts.cpvPrefix) params.CPV = opts.cpvPrefix;

  let raw: RawContract[];
  try {
    raw = await callApi<RawContract>('GetInfoContrato', params, token, CONTRACTS_TIMEOUT_MS);
  } catch (err) {
    return {
      rows: [],
      apiCount: 0,
      contractsUnavailable: true,
      unavailableReason: err instanceof Error ? err.message : String(err),
    };
  }

  const apiCount = raw.length;
  // Same code-side window as announcements: publication date, falling back to the signing date.
  let rows = raw
    .filter((c) => inWindow(parsePtDate(c.dataPublicacao) ?? parsePtDate(c.dataCelebracaoContrato), days))
    .map(shapeContract);

  if (typeof opts.minValue === 'number') {
    const floor = opts.minValue;
    rows = rows.filter((c) => c.value === null || c.value >= floor);
  }

  rows.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  return {
    rows,
    apiCount,
    contractsUnavailable: apiCount === 0,
    ...(apiCount === 0 ? { unavailableReason: 'the contracts lane answered an empty body' } : {}),
  };
}
