// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MEMBER DIRECTORY — portal → member profile docs + a deterministic manifest.
//
// Ground truth (docs/ahk-tender-matching-plan.md): the chamber's public member portal exposes
// `GET /home/getMembers.json?page=N` (16 rows/page, no auth). Coverage is thin — activity free-text
// is 99% present but a median 67 chars, sector codes only 34% — so THE SECTOR IS DERIVED BY US,
// never read off the row.
//
// Two laws from the plan govern this module:
//   • LAW 4 — THE PROFILE IS THE PRODUCT. A profile doc is an accreting document: directory row
//     today, website/award enrichment later, staff corrections forever (the trailing
//     "## Chamber notes" section is that door, born empty).
//   • DERIVATION IS CACHED BY CONTENT. Every member carries a contentHash over the text the
//     derivation actually reads; an unchanged member is never re-classified, so a weekly re-sync
//     costs zero AI.
//
// Tier law: classification runs through getAIClient(userId, 'classification', supabase) — this is
// user-scoped work, so getSystemClient is never an option.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { PROFILE_MANIFEST_VERSION, type ProfileManifest } from '@/lib/matching/manifest';

export const MEMBER_FOLDER_NAME = 'AHK Member companies';
export const MEMBER_MANIFEST_KIND = 'tender_member_manifest';
export const MEMBER_MANIFEST_VERSION = 1;

const PORTAL_BASE = 'https://portalahk.ccila-portugal.com/home/getMembers.json';
/** The member's own page on the portal — the link a staff member follows to see the source row. */
const PORTAL_PROFILE_BASE = 'https://portalahk.ccila-portugal.com/home/profile';
const PAGE_DELAY_MS = 500;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ─── The row as the portal serves it (every field is a string-or-null in practice) ──────────────

export interface PortalMember {
  id: string;
  name: string;
  abbreviated_name?: string | null;
  about_us?: string | null;
  about_us_de?: string | null;
  activity?: string | null;
  activity_type_1?: string | null;
  activity_type_2?: string | null;
  site?: string | null;
  email1?: string | null;
  phone1?: string | null;
  street?: string | null;
  postal_description?: string | null;
  employees_nr?: string | null;
  birth?: string | null;
  social_capital?: string | null;
  [k: string]: unknown;
}

// ─── The tag vocabulary (fixed, German — the Chamber's own lens) ─────────────────────────────────
// Chosen to cover the briefing plan's radar sectors plus the sectors the 1,002 real member rows
// actually describe. A closed list is what makes the manifest joinable against CPV divisions;
// "Sonstiges" is the honest escape, never a dumping ground the judge can be fed.

export const SECTOR_TAGS = [
  'IT/Software',
  'Maschinenbau',
  'Bau/Infrastruktur',
  'Energie',
  'Gesundheit/Medizintechnik',
  'Logistik/Transport',
  'Recht/Steuern/Beratung',
  'Finanzen',
  'Handel/Konsumgüter',
  'Tourismus',
  'Immobilien',
  'Bildung',
  'Umwelt/Wasser',
  'Automotive',
  'Textil',
  'Agrar/Lebensmittel',
  'Pharma/Chemie',
  'Telekom',
  'Verbände',
  'Sonstiges',
] as const;

export type SectorTag = (typeof SECTOR_TAGS)[number];
const TAG_SET = new Set<string>(SECTOR_TAGS);

/** The CPV divisions (2-digit) a sector plausibly bids in — the coverage gate's raw material.
 *  Deliberately generous per tag: a missed division silently starves the matcher, an extra one
 *  only costs the judge one more candidate. */
const TAG_CPV: Record<SectorTag, string[]> = {
  'IT/Software': ['48', '72', '30'],
  'Maschinenbau': ['42', '43', '31'],
  'Bau/Infrastruktur': ['45', '44', '71'],
  'Energie': ['09', '31', '71'],
  'Gesundheit/Medizintechnik': ['33', '85'],
  'Logistik/Transport': ['60', '63', '34'],
  'Recht/Steuern/Beratung': ['79', '71'],
  'Finanzen': ['66', '79'],
  'Handel/Konsumgüter': ['39', '18', '30'],
  'Tourismus': ['55', '63'],
  'Immobilien': ['70', '45'],
  'Bildung': ['80'],
  'Umwelt/Wasser': ['90', '41', '45'],
  'Automotive': ['34', '50'],
  'Textil': ['18', '19'],
  'Agrar/Lebensmittel': ['03', '15'],
  'Pharma/Chemie': ['33', '24'],
  'Telekom': ['32', '64'],
  'Verbände': ['75', '79'],
  'Sonstiges': [],
};

export interface MemberDerived {
  sectorTags: SectorTag[];
  cpvDivisions: string[];
  germanLink: boolean;
  /** How the tags were decided — the honesty channel for the run ledger. */
  via: 'deterministic' | 'ai' | 'cached';
}

export interface ManifestMember {
  portalId: string;
  name: string;
  sectorTags: SectorTag[];
  cpvDivisions: string[];
  sizeBand: string;
  district: string | null;
  germanLink: boolean;
  contentHash: string;
}

export interface MemberManifest {
  version: number;
  syncedAt: string;
  members: ManifestMember[];
}

// ─── The pull ────────────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page: number): Promise<{ rows: PortalMember[]; itemCount: number; perPage: number }> {
  const res = await fetch(`${PORTAL_BASE}?page=${page}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`portal page ${page} returned ${res.status}`);
  const json = (await res.json()) as { data?: PortalMember[]; meta?: Record<string, unknown> };
  const rows = Array.isArray(json.data) ? json.data : [];
  const itemCount = Number(json.meta?.item_count ?? 0);
  const perPage = Number(json.meta?.item_per_page ?? 16) || 16;
  return { rows, itemCount, perPage };
}

/**
 * Every member the portal knows, in portal order, deduped by id.
 * FAILS LOUD on a short pull: the directory is the matcher's whole universe — quietly returning
 * 800 of 1,002 members would silently disqualify 200 companies from every future match.
 */
export async function fetchMemberDirectory(opts?: { maxPages?: number }): Promise<PortalMember[]> {
  const first = await fetchPage(1);
  const total = first.itemCount;
  const perPage = first.perPage;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const lastPage = opts?.maxPages ? Math.min(pages, opts.maxPages) : pages;

  const byId = new Map<string, PortalMember>();
  for (const m of first.rows) if (m?.id) byId.set(String(m.id), m);

  for (let p = 2; p <= lastPage; p++) {
    await sleep(PAGE_DELAY_MS);
    const { rows } = await fetchPage(p);
    for (const m of rows) if (m?.id) byId.set(String(m.id), m);
  }

  const out = [...byId.values()];
  if (!opts?.maxPages && out.length < total) {
    throw new Error(`member directory short pull: got ${out.length} of ${total} (pages 1..${lastPage})`);
  }
  return out;
}

// ─── Deterministic derivations (no AI, no cache — pure functions of the row) ─────────────────────

/** The text the derivation reads — and therefore the text the content hash covers. */
export function derivationText(m: PortalMember): string {
  return [m.name, m.activity, m.about_us, m.about_us_de]
    .map((s) => String(s ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');
}

export function memberContentHash(m: PortalMember): string {
  return createHash('sha256').update(derivationText(m)).digest('hex').slice(0, 32);
}

/** Employee count → a band. The portal stores "0" for both "unknown" and "none" — 158 rows sit
 *  there — so 0 is reported as unknown, never as a company with no staff. */
export function sizeBandOf(m: PortalMember): string {
  const n = Number(String(m.employees_nr ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 'unbekannt';
  if (n <= 9) return '1–9';
  if (n <= 49) return '10–49';
  if (n <= 249) return '50–249';
  return '250+';
}

// PT postal districts by the first two digits of the code — the only region signal the row carries.
const PT_DISTRICT: Record<string, string> = {
  '10': 'Lisboa', '11': 'Lisboa', '12': 'Lisboa', '13': 'Lisboa', '14': 'Lisboa',
  '15': 'Lisboa', '16': 'Lisboa', '17': 'Lisboa', '18': 'Lisboa', '19': 'Lisboa',
  '20': 'Santarém', '21': 'Santarém', '22': 'Santarém', '23': 'Santarém',
  '24': 'Leiria', '25': 'Leiria', '26': 'Lisboa', '27': 'Lisboa', '28': 'Setúbal', '29': 'Setúbal',
  '30': 'Coimbra', '31': 'Coimbra', '32': 'Guarda', '33': 'Coimbra', '34': 'Castelo Branco',
  '35': 'Guarda', '36': 'Viseu', '37': 'Aveiro', '38': 'Aveiro', '39': 'Coimbra',
  '40': 'Porto', '41': 'Porto', '42': 'Porto', '43': 'Porto', '44': 'Porto', '45': 'Porto',
  '46': 'Braga', '47': 'Braga', '48': 'Braga', '49': 'Viana do Castelo',
  '50': 'Vila Real', '51': 'Vila Real', '52': 'Vila Real', '53': 'Bragança', '54': 'Bragança',
  '55': 'Bragança', '56': 'Viseu', '57': 'Bragança', '58': 'Vila Real', '59': 'Viseu',
  '60': 'Castelo Branco', '61': 'Castelo Branco', '62': 'Portalegre', '63': 'Castelo Branco',
  '64': 'Guarda', '65': 'Guarda', '66': 'Guarda', '67': 'Castelo Branco', '68': 'Guarda',
  '70': 'Évora', '71': 'Évora', '72': 'Portalegre', '73': 'Portalegre', '74': 'Beja',
  '75': 'Setúbal', '76': 'Évora', '77': 'Beja', '78': 'Beja', '79': 'Évora',
  '80': 'Faro', '81': 'Faro', '82': 'Faro', '83': 'Faro', '84': 'Faro', '85': 'Faro',
  '90': 'Madeira', '91': 'Madeira', '92': 'Madeira', '93': 'Madeira', '94': 'Madeira',
  '95': 'Açores', '96': 'Açores', '97': 'Açores', '98': 'Açores', '99': 'Açores',
};

/** District from the postal line. Foreign addresses (a handful of members sit abroad) have no
 *  Portuguese district — null is the honest answer, never a guessed one. */
export function districtOf(m: PortalMember): string | null {
  const raw = String(m.postal_description ?? '').trim();
  if (!raw) return null;
  const pt = /(\d{4})-\d{3}/.exec(raw);
  if (!pt) return null;
  return PT_DISTRICT[pt[1].slice(0, 2)] ?? null;
}

export function cityOf(m: PortalMember): string | null {
  const raw = String(m.postal_description ?? '').trim();
  if (!raw) return null;
  const m2 = /\d{4}(?:-\d{3})?\s+(.+)$/.exec(raw);
  const city = (m2?.[1] ?? '').split('/')[0].trim();
  return city || null;
}

// ─── The deterministic pre-pass ─────────────────────────────────────────────────────────────────
// Keyword evidence in the member's OWN text. Only unambiguous cases are settled here; everything
// else is handed to the judge. Keys are lowercase, accent-stripped substrings (PT · DE · EN).

const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const KEYWORDS: Array<[SectorTag, string[]]> = [
  ['Verbände', ['associacao ', 'associacao,', 'camara de comercio', 'camara municipal', 'federacao', 'verband', 'fundacao', 'instituto publico', 'ordem dos']],
  ['IT/Software', ['software', 'informatica', 'tecnologias de informacao', 'solucoes de ti', ' ti ', 'desenvolvimento web', 'digital', 'cibersegur', 'cloud', 'consultoria em sistemas de informacao']],
  ['Recht/Steuern/Beratung', ['advogad', 'sociedade de advogados', 'juridic', 'fiscalidade', 'contabilidade', 'auditoria', 'revisor oficial de contas', 'consultoria de gestao', 'recursos humanos', 'recrutamento', 'rechtsanwalt', 'steuerberat']],
  ['Bau/Infrastruktur', ['construcao', 'obras publicas', 'engenharia civil', 'arquitetura', 'empreitada', 'bauunternehmen']],
  ['Energie', ['energia', 'fotovoltaic', 'solar', 'eolic', 'eletricidade', 'energetic']],
  ['Gesundheit/Medizintechnik', ['saude', 'clinica', 'hospital', 'dispositivos medicos', 'equipamento medico', 'medizin']],
  ['Logistik/Transport', ['logistica', 'transporte', 'transitario', 'expedicao', 'armazenagem', 'spedition']],
  ['Automotive', ['automovel', 'automotive', 'componentes para automoveis', 'automocao']],
  ['Textil', ['textil', 'calcado', 'vestuario', 'confeccao', 'malhas']],
  ['Agrar/Lebensmittel', ['alimentar', 'agricola', 'vinho', 'agroalimentar', 'lebensmittel', 'produtos alimentares']],
  ['Pharma/Chemie', ['farmaceutic', 'quimic', 'chemie', 'pharma']],
  ['Telekom', ['telecomunicacoes', 'telecom', 'redes de telecomunicac']],
  ['Tourismus', ['turismo', 'hotel', 'hotelaria', 'restauracao', 'alojamento']],
  ['Immobilien', ['imobiliari', 'mediacao imobiliaria', 'immobilien']],
  ['Bildung', ['formacao', 'ensino', 'escola', 'academia', 'universidade', 'bildung']],
  ['Umwelt/Wasser', ['ambiente', 'residuos', 'aguas', 'saneamento', 'reciclagem', 'umwelt']],
  ['Finanzen', ['banco', 'seguros', 'seguradora', 'investimento', 'financeir', 'leasing']],
  ['Maschinenbau', ['maquinas', 'metalomecanica', 'metalurgic', 'moldes', 'maschinen', 'equipamento industrial']],
  ['Handel/Konsumgüter', ['comercio por grosso', 'importacao e exportacao', 'distribuicao', 'retalho', 'handel']],
];

const GERMAN_MARKS = [
  ' gmbh', 'gmbh', ' ag ', ' kg', ' se ', 'deutsch', 'alemanha', 'alema', 'german', 'germany',
  'berlin', 'munchen', 'hamburg', 'frankfurt', 'stuttgart', 'dusseldorf', 'koln',
];

/** True when the member's own name/text carries a German tie — the Chamber's ranking lens. */
export function germanLinkOf(m: PortalMember): boolean {
  const t = fold(` ${derivationText(m)} `);
  return GERMAN_MARKS.some((w) => t.includes(w));
}

/** The zero-AI read. Returns null when the text doesn't settle it — that's what the judge is for. */
export function deterministicTags(m: PortalMember): SectorTag[] | null {
  const t = fold(` ${derivationText(m)} `);
  if (t.trim().length < 4) return null;
  const hits: SectorTag[] = [];
  for (const [tag, words] of KEYWORDS) {
    if (words.some((w) => t.includes(w))) hits.push(tag);
  }
  // Two or more competing sectors from bare keywords is exactly the ambiguity a judge should
  // resolve; one clean hit is a fact.
  if (hits.length === 1) return hits;
  // An association is an association even when it also says "formação" — its own name decides.
  if (hits.includes('Verbände')) return ['Verbände'];
  return null;
}

export function cpvForTags(tags: SectorTag[], extra?: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) for (const c of TAG_CPV[t] ?? []) out.add(c);
  for (const c of extra ?? []) {
    const norm = String(c).replace(/\D/g, '').slice(0, 2);
    if (norm.length === 2) out.add(norm);
  }
  return [...out].sort();
}

// ─── The judged pass ─────────────────────────────────────────────────────────────────────────────

const CHUNK = 25;

export interface DeriveOptions {
  userId: string;
  supabase: SupabaseClient;
  /** portalId → previously derived facts, keyed by the content hash they were derived from. */
  cache?: Record<string, { contentHash: string; derived: MemberDerived }>;
  /** Skip every AI call (the dry-run / offline path) — unsettled members fall back to Sonstiges. */
  noAI?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface DeriveResult {
  derived: Record<string, MemberDerived>;
  stats: { cached: number; deterministic: number; ai: number; fallback: number; calls: number };
}

/**
 * ONE batched classification pass over the members whose text is new AND whose keywords didn't
 * settle it. Cheap tier, strict JSON, ~25 members per call.
 */
export async function deriveMemberFacts(members: PortalMember[], opts: DeriveOptions): Promise<DeriveResult> {
  const derived: Record<string, MemberDerived> = {};
  const stats = { cached: 0, deterministic: 0, ai: 0, fallback: 0, calls: 0 };
  const pending: PortalMember[] = [];

  for (const m of members) {
    const id = String(m.id);
    const hash = memberContentHash(m);
    const prior = opts.cache?.[id];
    if (prior && prior.contentHash === hash) {
      derived[id] = { ...prior.derived, via: 'cached' };
      stats.cached++;
      continue;
    }
    const det = deterministicTags(m);
    if (det) {
      derived[id] = { sectorTags: det, cpvDivisions: cpvForTags(det), germanLink: germanLinkOf(m), via: 'deterministic' };
      stats.deterministic++;
      continue;
    }
    pending.push(m);
  }

  if (pending.length && !opts.noAI) {
    const { client, model, endpoint, tier } = await getAIClient(opts.userId, 'classification', opts.supabase);
    for (let i = 0; i < pending.length; i += CHUNK) {
      const batch = pending.slice(i, i + CHUNK);
      const listing = batch
        .map((m) => `${m.id} :: ${derivationText(m).slice(0, 400)}`)
        .join('\n');

      const prompt = `You classify companies in a German-Portuguese chamber of commerce member directory, for matching them to public tenders.

For EACH line (format "id :: company name | activity text"), decide:
- sectorTags: 1-3 tags, ONLY from this exact list: ${SECTOR_TAGS.join(', ')}
- cpvDivisions: 0-4 two-digit EU CPV division codes the company could plausibly bid in (strings like "45", "72", "09"). Empty is fine when unclear.
- germanLink: true only if the name or text signals a German tie (GmbH/AG in the name, German words, a stated Germany connection). Otherwise false.

Rules: judge only from the given text — never invent a business the text does not describe. Use "Sonstiges" when the text is too thin to place, never as a filler beside a real tag.

Companies:
${listing}

Respond with ONLY a JSON array, one object per company, no prose:
[{"id":"<id>","sectorTags":["..."],"cpvDivisions":["45"],"germanLink":false}]`;

      let rows: Array<{ id?: string; sectorTags?: unknown; cpvDivisions?: unknown; germanLink?: unknown }> = [];
      try {
        const res = await aiCreate(client, {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 3000,
          temperature: 0.1,
        });
        stats.calls++;
        logAIUsage(opts.supabase, {
          userId: opts.userId, source: 'member_directory', provider: endpoint.provider, model, tier,
          taskType: 'classification', usage: res.usage,
        }).catch(() => {});
        rows = parseModelJSON(res.choices?.[0]?.message?.content ?? '', [] as typeof rows);
      } catch (e) {
        console.error('[member-directory] classification batch failed:', (e as Error).message);
        rows = [];
      }

      const byId = new Map(rows.filter((r) => r?.id).map((r) => [String(r.id), r]));
      for (const m of batch) {
        const id = String(m.id);
        const r = byId.get(id);
        const tags = Array.isArray(r?.sectorTags)
          ? (r!.sectorTags as unknown[]).map(String).filter((t): t is SectorTag => TAG_SET.has(t)).slice(0, 3)
          : [];
        if (tags.length) {
          const cpv = Array.isArray(r?.cpvDivisions) ? (r!.cpvDivisions as unknown[]).map(String) : [];
          derived[id] = {
            sectorTags: tags,
            cpvDivisions: cpvForTags(tags, cpv),
            // The model may see a tie the keyword net misses; the keyword net never lies about one.
            germanLink: germanLinkOf(m) || r?.germanLink === true,
            via: 'ai',
          };
          stats.ai++;
        } else {
          derived[id] = { sectorTags: ['Sonstiges'], cpvDivisions: [], germanLink: germanLinkOf(m), via: 'ai' };
          stats.fallback++;
        }
      }
      opts.onProgress?.(Math.min(i + CHUNK, pending.length), pending.length);
    }
  } else {
    for (const m of pending) {
      derived[String(m.id)] = {
        sectorTags: ['Sonstiges'], cpvDivisions: [], germanLink: germanLinkOf(m), via: 'deterministic',
      };
      stats.fallback++;
    }
  }

  return { derived, stats };
}

// ─── The profile document ────────────────────────────────────────────────────────────────────────

const line = (label: string, value: string | null | undefined): string =>
  `- **${label}:** ${value && String(value).trim() ? String(value).trim() : '—'}`;

/** The member's public profile page on the portal. */
export function memberPortalUrl(id: string | number): string {
  return `${PORTAL_PROFILE_BASE}/${String(id)}`;
}

/** A filesystem-safe, human-readable doc name. The portal id leads so the folder sorts stably and
 *  a doc is traceable to its row without opening it. */
export function memberDocFilename(m: PortalMember): string {
  const safe = String(m.name ?? 'Mitglied')
    .replace(/[\\/:*?"<>|\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${String(m.id)} ${safe || 'Mitglied'}.md`;
}

/**
 * ONE markdown doc per member. This is the thing the matcher reads (law 4) — never the raw row.
 * The trailing "## Chamber notes" header is deliberately empty: staff corrections accrete under it
 * and, being below the derived block, outrank it by reading order when a human scans the profile.
 */
/** THE WEBSITE SECTION's content, as the enrichment pass produced it (lib/tenders/enrich-members).
 *  Optional by construction: a member with no site, a dead site, or a site too thin to say anything
 *  renders exactly the doc it always did. */
export interface MemberWebsiteNote {
  /** The factual paragraph. Never marketing prose, never a guess — see enrich-members.ts. */
  paragraph: string;
  /** The page it was read from — the stamp's source half. */
  url: string;
  /** ISO day the page was fetched — the stamp's date half. */
  fetchedAt: string;
}

/** The heading the enrichment section wears. Bilingual on purpose: the doc is German, the section
 *  is written in whatever language the company's own site speaks. */
export const WEBSITE_SECTION_HEADING = '## Von der Website / From the website';

export function renderMemberProfileDoc(
  m: PortalMember,
  derived: MemberDerived,
  opts?: { syncedAt?: string; website?: MemberWebsiteNote | null },
): string {
  const syncedAt = (opts?.syncedAt ?? new Date().toISOString()).slice(0, 10);
  const activity = String(m.activity ?? '').trim();
  const about = [m.about_us, m.about_us_de].map((s) => String(s ?? '').trim()).filter(Boolean);
  const city = cityOf(m);
  const district = districtOf(m);
  // Lisboa sits in Lisboa — a district that only repeats the city says nothing.
  const location = [city, district && district !== city ? district : null].filter(Boolean).join(', ');

  const out: string[] = [];
  out.push(`# ${String(m.name ?? '').trim() || `Mitglied ${m.id}`}`);
  out.push('');
  out.push('## Tätigkeit');
  out.push(activity || '_Keine Tätigkeitsbeschreibung im Mitgliederverzeichnis._');
  if (about.length) {
    out.push('');
    out.push('## Über das Unternehmen');
    for (const a of about) out.push(a);
  }
  out.push('');
  out.push('## Einordnung (abgeleitet)');
  out.push(line('Branchen-Tags', derived.sectorTags.join(', ')));
  out.push(line('CPV-Divisionen', derived.cpvDivisions.join(', ')));
  out.push(line('Deutschland-Bezug', derived.germanLink ? 'ja' : 'nein'));
  // NB: `derived.via` deliberately does NOT render. It says how THIS RUN reached the tags
  // (judged the first time, cached the next) — a fact about the run, not about the company. In the
  // doc it made every AI-derived profile rewrite itself on the second sync, which is the whole
  // idempotence promise. Provenance lives in the manifest; the doc carries only member facts.
  out.push('');
  out.push('## Stammdaten');
  out.push(line('Größenklasse (Mitarbeiter)', `${sizeBandOf(m)}${String(m.employees_nr ?? '').trim() && Number(m.employees_nr) > 0 ? ` (${m.employees_nr})` : ''}`));
  out.push(line('Gründungsjahr', String(m.birth ?? '').trim() || null));
  out.push(line('Standort', location || String(m.postal_description ?? '').trim() || null));
  out.push(line('Website', String(m.site ?? '').trim() || null));
  out.push(line('Portal-ID', String(m.id)));
  // The source row, one click away — a profile that cannot be traced back to the portal is a claim
  // the reader has to take on trust.
  out.push(line('Portal-Profil', memberPortalUrl(m.id)));
  out.push('');
  out.push(`_Quelle: AHK-Mitgliederverzeichnis (Portal), Stand ${syncedAt}._`);
  // THE ENRICHMENT RUNG (law 4 — the profile is the product): the company's own website, read once
  // and summarised to stated facts. It sits BELOW the directory sections (the portal row is the
  // spine; this accretes onto it) and ABOVE "## Chamber notes" (a human's correction outranks
  // everything a machine wrote, and reading order is how that is said). It carries its own source
  // stamp, so a reader always knows which sentence came from where and when.
  const site = opts?.website;
  if (site && site.paragraph.trim()) {
    out.push('');
    out.push(WEBSITE_SECTION_HEADING);
    out.push(site.paragraph.trim());
    out.push('');
    out.push(`_Quelle: ${site.url}, abgerufen ${String(site.fetchedAt).slice(0, 10)}._`);
  }
  out.push('');
  out.push('## Chamber notes');
  out.push('');
  return out.join('\n');
}

// ─── The manifest ────────────────────────────────────────────────────────────────────────────────

export function buildManifest(
  members: PortalMember[],
  derived: Record<string, MemberDerived>,
  syncedAt = new Date().toISOString(),
): MemberManifest {
  return {
    version: MEMBER_MANIFEST_VERSION,
    syncedAt,
    members: members.map((m) => {
      const id = String(m.id);
      const d = derived[id] ?? { sectorTags: ['Sonstiges'] as SectorTag[], cpvDivisions: [], germanLink: false, via: 'deterministic' as const };
      return {
        portalId: id,
        name: String(m.name ?? '').trim(),
        sectorTags: d.sectorTags,
        cpvDivisions: d.cpvDivisions,
        sizeBand: sizeBandOf(m),
        district: districtOf(m),
        germanLink: d.germanLink,
        contentHash: memberContentHash(m),
      };
    }),
  };
}

/** The derivation cache the next sync reads — portalId → {hash, facts}. */
export function cacheFromManifest(man: MemberManifest | null): Record<string, { contentHash: string; derived: MemberDerived }> {
  const out: Record<string, { contentHash: string; derived: MemberDerived }> = {};
  for (const m of man?.members ?? []) {
    out[m.portalId] = {
      contentHash: m.contentHash,
      derived: {
        sectorTags: (m.sectorTags ?? []).filter((t): t is SectorTag => TAG_SET.has(t)),
        cpvDivisions: m.cpvDivisions ?? [],
        germanLink: !!m.germanLink,
        via: 'cached',
      },
    };
  }
  return out;
}

export async function readMemberManifest(admin: SupabaseClient, userId: string): Promise<MemberManifest | null> {
  try {
    const { data, error } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', MEMBER_MANIFEST_KIND).eq('entity_id', 'me').maybeSingle();
    if (error) { console.error('[member-directory] manifest read failed:', error.message); return null; }
    const t = data?.tasks as MemberManifest | undefined;
    return t && Array.isArray(t.members) ? t : null;
  } catch { return null; }
}

// ─── DEPARTURE PRUNING ───────────────────────────────────────────────────────────────────────────
// A member who leaves the chamber disappears from the portal — and, until this, kept a profile doc
// that the matcher would happily keep proposing. A departed member's doc must go.
//
// THE GUARD IS THE WHOLE POINT: pruning is only ever computed from a FULL pull. A short, capped or
// half-failed fetch looks exactly like a mass departure, and a mass delete off a bad fetch would
// destroy the folder. `full` must be the caller's own proof (no --limit, no maxPages, the fetch's
// short-pull assertion passed).

export interface DepartureSelection {
  /** Portal ids present in the previous manifest and absent from this pull. */
  departed: string[];
  /** Why nothing was selected, when nothing was. */
  refusedReason: string | null;
}

export function selectDepartures(
  prior: MemberManifest | null,
  fetched: PortalMember[],
  opts: { full: boolean },
): DepartureSelection {
  if (!opts.full) {
    return { departed: [], refusedReason: 'the pull was partial — pruning needs a full directory fetch' };
  }
  if (!prior?.members?.length) return { departed: [], refusedReason: 'no previous manifest to compare against' };
  if (!fetched.length) return { departed: [], refusedReason: 'the pull returned no members at all' };

  const live = new Set(fetched.map((m) => String(m.id)));
  const departed = prior.members.map((m) => m.portalId).filter((id) => !live.has(id));
  return { departed, refusedReason: null };
}

/** The doc filenames a departed id could be wearing — the id leads by construction, so the prefix
 *  is the whole join (a member may have been renamed since its doc was written). */
export function memberDocPrefix(portalId: string): string {
  return `${portalId} `;
}

// ─── THE GENERIC PROFILE INDEX ───────────────────────────────────────────────────────────────────
// The matcher is generic: it reads a `profile_manifest` keyed by FOLDER, in a vocabulary that knows
// nothing about chambers or tenders. The chamber-specific facts (a German tie, a size band, a
// district) become display badges and a ranking number HERE, where they are still understood.

export function profileManifestFrom(manifest: MemberManifest, folder = MEMBER_FOLDER_NAME): ProfileManifest {
  return {
    version: PROFILE_MANIFEST_VERSION,
    folder,
    syncedAt: manifest.syncedAt,
    profiles: manifest.members.map((m) => ({
      profileId: m.portalId,
      name: m.name,
      keys: m.cpvDivisions ?? [],
      badges: [
        m.germanLink ? 'Deutschland-Bezug' : null,
        m.sizeBand && m.sizeBand !== 'unbekannt' ? `${m.sizeBand} MA` : null,
        m.district,
      ].filter((b): b is string => !!b),
      // WHERE THE PROFILE LIVES — the member's own portal page. The report links the matched name
      // straight to it, so a reader who wants the contact details is one click away.
      url: memberPortalUrl(m.portalId),
      // ORDERING CARRIES NO STANDING BOOST AT ALL (owner call, Sep 2 — the bias audit).
      //
      // The German-tie boost went first: every member is German-linked by membership itself, so
      // the derived flag only ever detected surface signals (GmbH in the name, German text) and
      // crowded Portuguese members out of the shortlist window.
      //
      // The SIZE boost goes with it. Size is weighed by the JUDGE, per tender, against the
      // contract's own value via the user's criteria ("their size should be plausible for the
      // contract value") — a flat shortlist boost double-counts that same signal and, being flat,
      // applies it regardless of contract size: it crowded small specialists out of EVERY window,
      // including the windows where they were the right answer. The size band stays visible as a
      // badge (data the reader and the judge both see); it is no longer a thumb on the scale.
      rank: 0,
    })),
  };
}

/** Replace-on-sync: one manifest row per user (the doc_theme idiom). */
export async function writeMemberManifest(admin: SupabaseClient, userId: string, manifest: MemberManifest): Promise<void> {
  const { error } = await admin.from('item_plans').upsert({
    user_id: userId,
    kind: MEMBER_MANIFEST_KIND,
    entity_id: 'me',
    tasks: manifest as never,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
  if (error) throw new Error(`manifest write failed: ${error.message}`);
}
