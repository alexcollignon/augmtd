// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TENDER-FETCH SUITE (permanent — docs/ahk-tender-matching-plan.md P1, law 5).
// One fetch, two consumers: the structured BASE reader and the briefing formatter must never
// disagree about what was published. These are LIVE gates against the real APIBase2 — the laws
// they hold are the ones that already failed in production once.
//
//   F1  THE STRUCTURED ROW — a 2-day window returns rows, every one carrying a stable id, an
//       official DR link and a platform link (100% presence, the client's hard requirement).
//   F2  THE OFFICIAL LINK IS REAL — one row's officialUrl answers 200 with a PDF content-type
//       (echoed or reconstructed, the audit's /cp_hora/{YYYY}/{MM}/{numDR}/{IdIncm}.pdf pattern).
//   F3  THE "INEXISTENTE" LAW — PrecoBase "Inexistente" parses to value:null + valueUnknown,
//       never NaN, and an absurd value floor returns EXACTLY the value-unknown rows: an
//       unpublished price is a row to review, never a row that silently disappears.
//   F4  AMENDMENT FOLDING — "Anúncio de Alteração" rows never appear as base rows by default,
//       are counted in amendmentsFolded, and come back as typed isAmendment rows on request.
//   F5  THE FORMATTER SPEAKS THE LINK — the pt-tenders executor renders a Link line for every
//       announcement it lists, a Sektor tag, and the folded-amendment accounting line.
//   F6  UNCAPPED — the structured fetch returns the whole window: base rows + folded amendments
//       account for every in-window row the API returned, past any rendering cap.
//
// No AI, no database, no fixtures — this suite writes nothing.
// Run: npx tsx --env-file=.env.local scripts/smoke-tenders-fetch.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { fetchAnnouncements, fetchContracts } from '@/lib/tenders/fetch';
import { executePtTenders, TENDERS_KIND_LABEL } from '@/lib/tools/pt-tenders';
import { parseMatchItemsFence } from '@/lib/matching/items';

/** The suite may be run bare — load .env.local ourselves so the header command is the whole one. */
async function loadEnv() {
  if (process.env.PORTAL_BASE_TOKEN) return;
  try {
    const raw = await (await import('node:fs/promises')).readFile('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* the token check below says what is missing */ }
}

const BASE_URL = 'https://www.base.gov.pt/APIBase2';

async function rawAnnouncements(days: number, token: string): Promise<Record<string, unknown>[]> {
  const url = new URL(`${BASE_URL}/GetInfoAnuncio`);
  url.searchParams.set('numDias', String(days));
  const res = await fetch(url.toString(), {
    headers: { '_AcessToken': token },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  await loadEnv();
  const token = process.env.PORTAL_BASE_TOKEN;
  if (!token) { console.error('PORTAL_BASE_TOKEN is not set — the suite cannot probe the live API.'); process.exit(1); }

  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const note = (t: string) => console.log(`  · ${t}`);

  // ── F1 · F6 — the structured row, and the whole window ────────────────────────────────────────
  console.log('\nF — THE STRUCTURED FETCH (live)');
  const raw2 = await rawAnnouncements(2, token);
  const short = await fetchAnnouncements({ days: 2 });
  note(`API returned ${raw2.length} rows over 2 days · ${short.inWindowCount} in the code-side window · ${short.rows.length} base rows + ${short.amendmentsFolded} amendments`);

  ok('F1 a 2-day window returns rows', short.rows.length > 0, `${short.rows.length}`);
  ok('F1 every row carries a stable id (nAnuncio::IdIncm)',
    short.rows.every(r => /^\S+::\d+$/.test(r.id)),
    short.rows.find(r => !/^\S+::\d+$/.test(r.id))?.id);
  ok('F1 every row carries an official DR link',
    short.rows.every(r => !!r.officialUrl && r.officialUrl.startsWith('https://')),
    `${short.rows.filter(r => !r.officialUrl).length} without`);
  ok('F1 every row carries a platform link',
    short.rows.every(r => !!r.platformUrl && r.platformUrl.startsWith('http')),
    `${short.rows.filter(r => !r.platformUrl).length} without`);
  ok('F1 every row carries the contracting authority NIF (the join key the formatter strips)',
    short.rows.every(r => /^\d{9}$/.test(r.entityNif)),
    `${short.rows.filter(r => !/^\d{9}$/.test(r.entityNif)).length} without`);
  ok('F1 no row carries a NaN value (Inexistente and friends are null)',
    short.rows.every(r => r.value === null || Number.isFinite(r.value)));

  // THE RENDERING CAP IS THE CONSUMER'S — the reader accounts for every in-window row.
  ok('F6 base rows + folded amendments account for every in-window row',
    short.rows.length + short.amendmentsFolded === short.inWindowCount,
    `${short.rows.length}+${short.amendmentsFolded} vs ${short.inWindowCount}`);
  if (short.inWindowCount > 30) {
    ok('F6 the fetch is uncapped — the window exceeded the formatter\'s 30-item cap and no row was lost',
      short.rows.length + short.amendmentsFolded > 30);
  } else {
    note(`F6 the live 2-day window held only ${short.inWindowCount} rows — the >30 assertion could not be exercised; the accounting identity above still holds`);
  }

  // ── F2 — the official link is real ────────────────────────────────────────────────────────────
  const linkRow = short.rows.find(r => !!r.officialUrl);
  if (linkRow?.officialUrl) {
    const res = await fetch(linkRow.officialUrl, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const ct = res?.headers.get('content-type') ?? '';
    ok('F2 an officialUrl answers 200 with a PDF content-type',
      !!res && res.ok && /pdf/i.test(ct), `${res?.status} ${ct}`);
    if (res) await res.arrayBuffer().catch(() => null);
  } else {
    ok('F2 an officialUrl answers 200 with a PDF content-type', false, 'no row carried an official link');
  }

  // ── F3 — the "Inexistente" law ────────────────────────────────────────────────────────────────
  console.log('\nF3 — THE VALUE-UNKNOWN LAW (a week window)');
  const week = await fetchAnnouncements({ days: 7 });
  const rawWeek = await rawAnnouncements(7, token);
  const rawUnpriced = rawWeek.filter(r => {
    const p = String((r as { PrecoBase?: string }).PrecoBase ?? '').trim();
    return p === '' || !/\d/.test(p);
  });
  note(`${rawUnpriced.length} raw rows carry no parseable PrecoBase (e.g. ${rawUnpriced.map(r => (r as { PrecoBase?: string }).PrecoBase).slice(0, 3).join(', ') || 'none this week'})`);

  ok('F3 no fetched row has a NaN value',
    week.rows.every(r => r.value === null || Number.isFinite(r.value)));
  ok('F3 value === null implies valueUnknown, and vice versa',
    week.rows.every(r => (r.value === null) === r.valueUnknown));

  // An absurd floor: the only rows that may survive it are the value-unknown ones — a floor must
  // never be the door an unpriced tender falls through.
  const floored = await fetchAnnouncements({ days: 7, minValue: 1e12 });
  ok('F3 an absurd value floor returns exactly the value-unknown rows',
    floored.rows.length === week.rows.filter(r => r.valueUnknown).length
      && floored.rows.every(r => r.valueUnknown),
    `${floored.rows.length} survivors vs ${week.rows.filter(r => r.valueUnknown).length} value-unknown`);
  ok('F3 the floor accounts for what it dropped',
    floored.belowFloor === week.rows.filter(r => !r.valueUnknown).length,
    `${floored.belowFloor} vs ${week.rows.filter(r => !r.valueUnknown).length}`);

  // ── F4 — amendment folding ────────────────────────────────────────────────────────────────────
  console.log('\nF4 — AMENDMENT FOLDING');
  note(`${week.amendmentsFolded} amendments folded this week (${week.amendmentsOrphaned} amend announcements published before the window)`);
  ok('F4 no base row is an amendment', week.rows.every(r => !r.isAmendment));
  ok('F4 no base row wears an "alteração" tipoActo', week.rows.every(r => !/altera/i.test(r.tipoActo)));
  ok('F4 amendments were actually present to fold (else the gate proves nothing)', week.amendmentsFolded > 0,
    `${week.amendmentsFolded}`);

  const withAmendments = await fetchAnnouncements({ days: 2, includeAmendments: true });
  ok('F4 includeAmendments returns them as typed rows marked isAmendment',
    withAmendments.rows.filter(r => r.isAmendment).length === short.amendmentsFolded
      && withAmendments.rows.length === short.rows.length + short.amendmentsFolded,
    `${withAmendments.rows.filter(r => r.isAmendment).length}/${short.amendmentsFolded}`);
  ok('F4 folded amendments land on their base row where the base is in-window',
    week.rows.reduce((n, r) => n + r.amendments, 0) === week.amendmentsFolded - week.amendmentsOrphaned,
    `${week.rows.reduce((n, r) => n + r.amendments, 0)} vs ${week.amendmentsFolded - week.amendmentsOrphaned}`);

  // ── F5 — the formatter ────────────────────────────────────────────────────────────────────────
  console.log('\nF5 — THE FORMATTER (same window, the briefing\'s own door)');
  const md = await executePtTenders({ days: 2, endpoint: 'announcements' });
  const headings = md.split('\n').filter(l => /^### \d+\./.test(l));
  const links = md.split('\n').filter(l => l.startsWith('- **Link:** http'));
  const sektor = md.split('\n').filter(l => l.startsWith('- **Sektor:**'));
  note(`${headings.length} announcements rendered · ${links.length} Link lines · ${sektor.length} Sektor lines`);

  ok('F5 the formatter rendered announcements', headings.length > 0, `${headings.length}`);
  ok('F5 every rendered announcement carries a Link line', links.length === headings.length,
    `${links.length}/${headings.length}`);
  ok('F5 every rendered announcement carries a Sektor tag', sektor.length === headings.length,
    `${sektor.length}/${headings.length}`);
  ok('F5 the rendered count never exceeds the 30-item rendering cap', headings.length <= 30, `${headings.length}`);
  if (short.amendmentsFolded > 0) {
    ok('F5 the folded amendments are accounted for in words',
      /anúncio\(s\) de alteração agrupados/.test(md));
  } else {
    note('F5 no amendments in this window — the accounting line could not be exercised');
  }
  ok('F5 no rendered value is NaN or an empty number', !/\bNaN\b/.test(md));

  // ── F7 — THE STRUCTURED HANDOFF (additive; the flag is OFF by default and changes nothing) ────
  console.log('\nF7 — THE MATCH-ITEMS FENCE (the source→matcher handoff)');
  ok('F7 with the flag unset the output carries no fence', !md.includes('match-items'));
  const structured = await executePtTenders({ days: 2, endpoint: 'announcements', structured_output: true });
  ok('F7 the markdown above the fence is byte-identical to the unflagged output',
    structured.startsWith(md), `${structured.length} vs ${md.length} chars`);
  const block = parseMatchItemsFence(structured);
  ok('F7 the appended fence parses', !!block, block ? `${block.items.length} items` : 'no block');
  ok('F7 the fence carries EVERY in-window row, past the 30-item rendering cap',
    block?.items.length === short.rows.length, `${block?.items.length} vs ${short.rows.length}`);
  ok('F7 every item carries a stable id, a link and a collective label',
    !!block && block.items.every(i => !!i.id && !!i.url && i.kindLabel === TENDERS_KIND_LABEL));
  ok('F7 no item carries a NaN value (the Inexistente law survives the handoff)',
    !!block && block.items.every(i => i.value === null || Number.isFinite(i.value as number)));

  const floorMd = await executePtTenders({ days: 7, endpoint: 'announcements', min_value: 1e12 });
  if (week.rows.some(r => r.valueUnknown)) {
    ok('F5 value-unknown rows survive a floor and say so in words',
      /Wert nicht veröffentlicht/.test(floorMd));
  } else {
    note('F5 no value-unknown row this week — the "Wert nicht veröffentlicht" rendering could not be exercised');
  }

  // ── Contracts lane — best-effort, never a throw ────────────────────────────────────────────────
  console.log('\nC — THE CONTRACTS LANE (best-effort by design)');
  const contracts = await fetchContracts({ days: 2 });
  ok('C the contracts lane returns a result rather than throwing', Array.isArray(contracts.rows));
  note(contracts.contractsUnavailable
    ? `unavailable this run (${contracts.unavailableReason ?? 'no reason given'}) — flagged, not thrown`
    : `${contracts.rows.length} contracts in window of ${contracts.apiCount} returned`);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
