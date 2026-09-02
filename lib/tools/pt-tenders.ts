// ─── Portuguese Public Procurement tool (Portal Base / IMPIC) ────────────────
// A FORMATTER over `lib/tenders/fetch.ts` — the structured reader every consumer shares
// (docs/ahk-tender-matching-plan.md, law 5: one fetch, two consumers). Everything about talking to
// the API — the code-side day window, the "Inexistente" law, the DR-link reconstruction, amendment
// folding — lives there. What lives here is presentation: the item cap, the NIF strip, the sector
// wording — plus, behind `structured_output`, the generic match-items fence that hands the window
// to whatever step comes next. This tool knows nothing about who matches what: it publishes rows.
//
// Auth: PORTAL_BASE_TOKEN env var  (header: _AcessToken)
// Docs: https://www.base.gov.pt/APIBase2

import {
  fetchAnnouncements,
  fetchContracts,
  cpvDivisionsOf,
  TENDERS_MAX_DAYS,
  clampDays,
  type TenderAnnouncement,
  type TenderContract,
} from '@/lib/tenders/fetch';
import { renderMatchItemsFence, type MatchItem } from '@/lib/matching/items';
// The sector map now lives in ONE bilingual home beside the fence, because the MATCHER renders the
// tag labels in the report's language. This file keeps importing the GERMAN half for its own German
// briefing markdown — that prose is unchanged, byte for byte.
import { CPV_DIVISION_DE } from '@/lib/matching/vocabularies';

// A RENDERING cap only — the structured fetch is uncapped, and the accounting line below says
// so whenever it bites.
const MAX_ITEMS = 30;

// ── Presentation helpers ──────────────────────────────────────────────────────

function formatEur(value: number | null): string {
  if (value === null || value === 0) return '';
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function joinArr(arr: string[]): string {
  return arr.filter(Boolean).join('; ');
}

// Entity strings arrive as "600010180 - ESTADO-MAIOR…" — the NIF is kept in the structured row
// and stripped HERE, for display only.
function stripNif(s: string): string {
  return s.replace(/^\d{9}\s*-\s*/, '');
}

function formatEntityArr(arr: string[]): string {
  return arr.map(stripNif).filter(Boolean).join('; ');
}

function formatPtDate(d: Date | null, raw: string): string {
  if (raw) return raw;
  if (!d) return '—';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function sectorTag(a: TenderAnnouncement): string {
  const tags: string[] = [];
  for (const cpv of a.cpvs) {
    const label = CPV_DIVISION_DE[cpv.division] ?? cpv.label;
    if (label && !tags.includes(label)) tags.push(label);
  }
  return tags.join('; ') || '—';
}

function formatContract(c: TenderContract, idx: number): string {
  return [
    `### ${idx + 1}. ${c.title || '(sem título)'}`,
    `- **Adjudicante:** ${formatEntityArr(c.buyers) || '—'}`,
    `- **Adjudicatário:** ${formatEntityArr(c.suppliers) || '—'}`,
    `- **Valor:** ${formatEur(c.value) || '—'}`,
    `- **Data contrato:** ${formatPtDate(c.signedAt, c.signedRaw)}  |  **Publicação:** ${formatPtDate(c.publishedAt, c.publishedRaw)}`,
    `- **CPV:** ${joinArr(c.cpvs.map(v => `${v.code} - ${v.label}`)) || '—'}`,
    `- **Local:** ${joinArr(c.places) || '—'}`,
    `- **Prazo execução:** ${c.executionDays ? `${c.executionDays} dias` : '—'}`,
    `- **Procedimento:** ${c.procedureType || '—'}`,
  ].join('\n');
}

function formatAnnouncement(a: TenderAnnouncement, idx: number): string {
  // A row whose base price the authority never published is rendered, never dropped — the
  // briefing says so in words rather than presenting a missing number as a zero.
  const value = a.valueUnknown ? 'Wert nicht veröffentlicht' : (formatEur(a.value) || '—');
  const deadline = a.deadlineRaw
    ? a.deadlineRaw
    : a.deadline
      ? `${formatPtDate(a.deadline, '')} (${a.proposalDays} dias a partir da publicação)`
      : '—';

  return [
    `### ${idx + 1}. ${a.description || '(sem título)'}`,
    `- **Entidade:** ${a.entityName || '—'}`,
    `- **Sektor:** ${sectorTag(a)}`,
    `- **Tipo:** ${a.procedureType || a.tipoActo || '—'}`,
    `- **Base:** ${value}`,
    `- **Publicação:** ${formatPtDate(a.publishedAt, a.publishedRaw)}  |  **Limite propostas:** ${deadline}`,
    `- **CPV:** ${joinArr(a.cpvs.map(v => `${v.code} - ${v.label}`)) || '—'}`,
    `- **Contrato:** ${joinArr(a.contractTypes) || '—'}`,
    ...(a.lots.length ? [`- **Lotes:** ${joinArr(a.lots)}`] : []),
    // The official link the client asked for: the Diário da República publication PDF.
    `- **Link:** ${a.officialUrl ?? '—'}`,
    ...(a.platformUrl ? [`- **Documentos:** ${a.platformUrl}`] : []),
    ...(a.amendments > 0 ? [`- **Alterações:** ${a.amendments} anúncio(s) de alteração nesta janela`] : []),
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PtTendersConfig {
  days?: number;
  endpoint?: 'contracts' | 'announcements' | 'both';
  cpv_prefix?: string;
  min_value?: number;
  /** Append the generic match-items fence after the markdown, so a matcher step downstream can read
   *  the announcements as structured items. OFF by default: with the flag unset this tool's output
   *  is byte-identical to what it has always produced. */
  structured_output?: boolean;
}

/** The collective noun a downstream matcher's headings will use when it cannot say TENDERS_KIND
 *  itself. German, because this tool's own briefing is German — it is a FALLBACK, not the label. */
export const TENDERS_KIND_LABEL = 'Ausschreibungen';

/** THE SEMANTIC KIND — language-free, so a matcher writes the noun in ITS report's language. */
export const TENDERS_KIND = 'tenders';

/**
 * Announcement rows → the generic item shape. Nothing here knows about profiles or matching: it
 * publishes what the row holds, and the matcher decides what to do with it.
 *
 * THE FENCE SPEAKS IN CODES, NOT WORDS. A source cannot know what language the report it feeds will
 * be written in, so every label it would otherwise hardcode (the fact keys, the sector tags, the
 * collective noun) ships as a SEMANTIC id and the matcher renders the word. What stays here is what
 * genuinely belongs to the source: the values themselves, in whatever language the portal published
 * them. The German markdown above the fence is this tool's own briefing and is untouched.
 */
export function announcementsToMatchItems(rows: TenderAnnouncement[]): MatchItem[] {
  return rows.map((a) => {
    const facts: Record<string, string> = {};
    if (a.entityName) facts.buyer = stripNif(a.entityName);
    const procedure = a.procedureType || a.tipoActo;
    if (procedure) facts.procedure = procedure;
    if (a.contractTypes.length) facts.contractType = joinArr(a.contractTypes);
    const cpv = joinArr(a.cpvs.map(v => `${v.code} ${v.label}`));
    if (cpv) facts.cpv = cpv;
    if (a.lots.length) facts.lots = String(a.lots.length);
    if (a.nAnuncio) facts.noticeNo = a.nAnuncio;
    // Its own key rather than a German suffix on the notice number — a value must not smuggle a word.
    if (a.amendments > 0) facts.amendments = String(a.amendments);

    return {
      id: a.id,
      title: a.description || a.procedureType || a.nAnuncio,
      description: a.description,
      kindLabel: TENDERS_KIND_LABEL,
      kind: TENDERS_KIND,
      url: a.officialUrl ?? undefined,
      secondaryUrl: a.platformUrl ?? undefined,
      value: a.value,
      valueUnknown: a.valueUnknown,
      deadline: a.deadline ? a.deadline.toISOString() : null,
      // The German strings stay as the fallback an unknowing consumer reads; `tagCodes` is what a
      // language-aware matcher renders from.
      tags: sectorTag(a) === '—' ? [] : sectorTag(a).split('; '),
      tagCodes: cpvDivisionsOf(a),
      // `keys` = the CPV divisions — the deterministic join a profile manifest can share.
      meta: { keys: cpvDivisionsOf(a), facts },
    };
  });
}

export async function executePtTenders(config: Record<string, unknown>): Promise<string> {
  if (!process.env.PORTAL_BASE_TOKEN) return '[pt_tenders] PORTAL_BASE_TOKEN env var is not set.';

  const days = Math.min(typeof config.days === 'number' ? config.days : 7, TENDERS_MAX_DAYS);
  const endpoint = (config.endpoint as string) ?? 'both';
  const cpvPrefix = typeof config.cpv_prefix === 'string' ? config.cpv_prefix : undefined;
  const minValue = typeof config.min_value === 'number' ? config.min_value : undefined;
  const structured = config.structured_output === true;

  const sections: string[] = [];
  // The fence rides BESIDE the markdown, appended once at the end — the prose above it is exactly
  // what it always was.
  let fence: string | null = null;

  // ── Contracts ───────────────────────────────────────────────────────────────
  if (endpoint === 'contracts' || endpoint === 'both') {
    const res = await fetchContracts({ days: clampDays(days), cpvPrefix, minValue });
    const shown = res.rows.slice(0, MAX_ITEMS);

    if (shown.length === 0) {
      const why = res.contractsUnavailable
        ? `A API de contratos não respondeu com dados${res.unavailableReason ? ` (${res.unavailableReason})` : ''}.`
        : `A API devolveu ${res.apiCount} registos, todos fora da janela ou sem data.`;
      sections.push(`## Contratos Adjudicados (últimos ${days} dias)\n\nNenhum contrato publicado dentro da janela de ${days} dias. ${why} NÃO usar registos antigos como notícias da semana.`);
    } else {
      sections.push(
        `## Contratos Adjudicados (últimos ${days} dias) — ${res.rows.length} dentro da janela (de ${res.apiCount} devolvidos pela API)`,
        ...(res.rows.length > shown.length
          ? [`_Mostrados os ${shown.length} mais recentes de ${res.rows.length}._`]
          : []),
        ...shown.map((c, i) => formatContract(c, i)),
      );
    }
  }

  // ── Announcements ────────────────────────────────────────────────────────────
  if (endpoint === 'announcements' || endpoint === 'both') {
    try {
      const res = await fetchAnnouncements({ days: clampDays(days), cpvPrefix, minValue });
      const shown = res.rows.slice(0, MAX_ITEMS);
      // STRUCTURED OUTPUT IS UNCAPPED: the rendering cap is a reading convenience, never a filter a
      // downstream matcher should inherit.
      if (structured) {
        fence = renderMatchItemsFence(announcementsToMatchItems(res.rows),
          { kindLabel: TENDERS_KIND_LABEL, kind: TENDERS_KIND });
      }

      // Honest drop accounting — every row the listing does not show is named here.
      const accounting: string[] = [];
      if (res.amendmentsFolded > 0) {
        accounting.push(
          `${res.amendmentsFolded} anúncio(s) de alteração agrupados com o anúncio original e não listados como novas oportunidades` +
          (res.amendmentsOrphaned > 0 ? ` (${res.amendmentsOrphaned} alteram anúncios publicados antes desta janela)` : '') + '.',
        );
      }
      if (minValue !== undefined && res.belowFloor > 0) {
        accounting.push(`${res.belowFloor} anúncio(s) abaixo do valor mínimo de ${formatEur(minValue)} excluídos.`);
      }
      if (res.valueUnknownCount > 0) {
        accounting.push(`${res.valueUnknownCount} anúncio(s) sem preço base publicado mantidos para revisão ("Wert nicht veröffentlicht").`);
      }
      if (res.rows.length > shown.length) {
        accounting.push(`Mostrados os ${shown.length} mais recentes de ${res.rows.length} anúncios base.`);
      }

      if (shown.length === 0) {
        sections.push(
          `## Anúncios de Procedimento (últimos ${days} dias)\n\nNenhum anúncio publicado dentro da janela de ${days} dias (a API devolveu ${res.apiCount} registos). NÃO usar registos antigos como notícias da semana.` +
          (accounting.length ? `\n\n${accounting.join(' ')}` : ''),
        );
      } else {
        sections.push(
          `## Anúncios de Procedimento (últimos ${days} dias) — ${res.rows.length} anúncios base dentro da janela (de ${res.apiCount} devolvidos pela API)`,
          ...(accounting.length ? [`_${accounting.join(' ')}_`] : []),
          ...shown.map((a, i) => formatAnnouncement(a, i)),
        );
      }
    } catch (err) {
      sections.push(`## Anúncios de Procedimento\n\n[Erro: ${err instanceof Error ? err.message : String(err)}]`);
    }
  }

  const markdown = sections.join('\n\n');
  return fence ? `${markdown}\n\n${fence}` : markdown;
}
