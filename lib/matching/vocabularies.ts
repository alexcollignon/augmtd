// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHARED VOCABULARIES — the bilingual halves of the match-items fence.
//
// THE LAW THIS FILE EXISTS FOR: a source step does not know what language the report will be
// written in, so it must never hand a matcher a WORD. It hands over a CODE (a kind id, a fact key,
// a taxonomy code) and the matcher — the one place that owns a language table — renders the label.
// A source that hands over words produces a half-translated report, which is exactly the leak this
// file closes.
//
// Direction of dependency: sources import FROM here (pt-tenders already imports the fence from
// lib/matching). Nothing in lib/matching imports a source. A source keeps its own markdown wording
// for its own briefing — that prose is the source's, and untouched.
//
// EXTENDING: a new source adds its kind noun + fact keys here in every language. An id this file
// does not know is never an error — the matcher falls back to what the source shipped (the display
// kindLabel, the fact key verbatim, the source's own tag strings), so an unknown vocabulary
// degrades to today's behaviour instead of breaking.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Kept as a bare union so a vocabulary can never import the matcher (which imports this file). */
export type VocabLanguage = 'de' | 'en';

type Vocab = Record<VocabLanguage, Record<string, string>>;

/**
 * SEMANTIC KIND → the collective noun a report's headings use, LOWERCASE where the language
 * allows it (the matcher capitalises at heading positions; German nouns are already capital).
 * A `kind` this table does not know falls back to the fence's own `kindLabel`.
 */
export const KIND_NOUNS: Vocab = {
  de: { tenders: 'Ausschreibungen', contracts: 'Verträge', candidates: 'Kandidaten', grants: 'Förderaufrufe' },
  en: { tenders: 'tenders', contracts: 'contracts', candidates: 'candidates', grants: 'grant calls' },
};

/**
 * THE SEMANTIC FACT-KEY REGISTRY — the label→value lines an item prints. A source emits the KEY;
 * this table holds the word. A key absent here renders VERBATIM, so an arbitrary source that has
 * never heard of this registry still works exactly as it did.
 */
export const FACT_LABELS: Vocab = {
  de: {
    buyer: 'Auftraggeber',
    procedure: 'Verfahrensart',
    contractType: 'Auftragsart',
    cpv: 'CPV',
    lots: 'Lose',
    noticeNo: 'Anzeigen-Nr.',
    amendments: 'Änderungsanzeigen',
    place: 'Ort',
    published: 'Veröffentlicht',
  },
  en: {
    buyer: 'Buyer',
    procedure: 'Procedure',
    contractType: 'Contract type',
    cpv: 'CPV',
    lots: 'Lots',
    noticeNo: 'Notice no.',
    amendments: 'Amendment notices',
    place: 'Place',
    published: 'Published',
  },
};

/**
 * CPV DIVISIONS — the two-digit division code → sector label. THE ONE HOME for this map: the
 * tenders source imports the German half for its own (German) briefing markdown, and the matcher
 * reads whichever half the report is written in. Extending a division means adding it in BOTH
 * languages, or it renders in neither (the all-or-nothing rule below).
 *
 * ⚠️ The matcher's tag rendering is ALL-OR-NOTHING by design: if any code on an item is unknown
 * here, the item falls back to the tag STRINGS the source shipped. A sector is never silently
 * dropped, and a tag line is never half-translated.
 */
export const CPV_DIVISIONS: Vocab = {
  de: {
    '03': 'Landwirtschaft & Fischerei',
    '09': 'Energie & Kraftstoffe',
    '14': 'Bergbau & Rohstoffe',
    '15': 'Lebensmittel & Getränke',
    '16': 'Landmaschinen',
    '18': 'Bekleidung & Textilien',
    '19': 'Leder & Textilwaren',
    '22': 'Druck & Verlag',
    '24': 'Chemie',
    '30': 'Büro- & EDV-Ausstattung',
    '31': 'Elektrische Ausrüstung',
    '32': 'Kommunikationstechnik',
    '33': 'Medizintechnik & Pharma',
    '34': 'Fahrzeuge & Transportausrüstung',
    '35': 'Sicherheit & Verteidigung',
    '37': 'Sport, Musik & Freizeitgeräte',
    '38': 'Labor- & Messtechnik',
    '39': 'Möbel & Ausstattung',
    '41': 'Wasserversorgung',
    '42': 'Maschinen & Anlagen',
    '43': 'Bergbau- & Baumaschinen',
    '44': 'Baustoffe & Bauteile',
    '45': 'Bau & Infrastruktur',
    '48': 'Software & IT-Systeme',
    '50': 'Reparatur & Wartung',
    '51': 'Installation',
    '55': 'Hotellerie & Gastronomie',
    '60': 'Transport & Verkehrsdienste',
    '63': 'Logistik & Transporthilfsdienste',
    '64': 'Post & Telekommunikation',
    '65': 'Ver- & Entsorgungsdienste',
    '66': 'Finanz- & Versicherungsdienste',
    '70': 'Immobiliendienste',
    '71': 'Architektur & Ingenieurwesen',
    '72': 'IT-Dienstleistungen',
    '73': 'Forschung & Entwicklung',
    '75': 'Öffentliche Verwaltung',
    '76': 'Öl- & Gasdienstleistungen',
    '77': 'Land- & Forstwirtschaftsdienste',
    '79': 'Unternehmensdienstleistungen',
    '80': 'Bildung & Ausbildung',
    '85': 'Gesundheits- & Sozialwesen',
    '90': 'Umwelt & Entsorgung',
    '92': 'Freizeit, Kultur & Sport',
    '98': 'Sonstige Dienstleistungen',
  },
  en: {
    '03': 'Agriculture & Fisheries',
    '09': 'Energy & Fuels',
    '14': 'Mining & Raw Materials',
    '15': 'Food & Beverages',
    '16': 'Agricultural Machinery',
    '18': 'Clothing & Textiles',
    '19': 'Leather & Textile Goods',
    '22': 'Printing & Publishing',
    '24': 'Chemicals',
    '30': 'Office & IT Equipment',
    '31': 'Electrical Equipment',
    '32': 'Communications Equipment',
    '33': 'Medical Devices & Pharmaceuticals',
    '34': 'Vehicles & Transport Equipment',
    '35': 'Security & Defence',
    '37': 'Sports, Music & Leisure Equipment',
    '38': 'Laboratory & Measuring Equipment',
    '39': 'Furniture & Furnishings',
    '41': 'Water Supply',
    '42': 'Machinery & Plant',
    '43': 'Mining & Construction Machinery',
    '44': 'Construction Materials & Components',
    '45': 'Construction & Infrastructure',
    '48': 'Software & IT Systems',
    '50': 'Repair & Maintenance',
    '51': 'Installation',
    '55': 'Hospitality & Catering',
    '60': 'Transport Services',
    '63': 'Logistics & Transport Support',
    '64': 'Postal & Telecommunications',
    '65': 'Utilities & Waste Services',
    '66': 'Financial & Insurance Services',
    '70': 'Real Estate Services',
    '71': 'Architecture & Engineering',
    '72': 'IT Services',
    '73': 'Research & Development',
    '75': 'Public Administration',
    '76': 'Oil & Gas Services',
    '77': 'Agricultural & Forestry Services',
    '79': 'Business Services',
    '80': 'Education & Training',
    '85': 'Health & Social Services',
    '90': 'Environment & Waste',
    '92': 'Leisure, Culture & Sport',
    '98': 'Other Services',
  },
};

/** The German half, under the name the tenders source has always used for its own markdown. */
export const CPV_DIVISION_DE = CPV_DIVISIONS.de;

// ─── THE SOURCE ITEM NOUN — DISPLAY ONLY ─────────────────────────────────────────────────────────
//
// THE LAW: this noun exists so the Studio sentence can read like a sentence ("For each tender …").
// It is DERIVED AT RENDER TIME from the step immediately above the matcher, it is NEVER stored in a
// step's config, and it NEVER reaches a run or a report — the run keeps reading the fence's own
// `kindLabel`/`kind`, which is the source's actual claim about what it handed over. A word typed
// into a panel must never be able to rename what the engine matched.
//
// A WHITELIST, NEVER A GUESS: an id absent from this table renders the honest generic 'item'. There
// is deliberately no fuzzy matching, no singularisation, no stemming — a wrong confident noun is
// worse than a plain one. Extending = one entry here for a source that genuinely ships one kind.

/** The noun a panel says when nothing above it is a known item source. */
export const GENERIC_ITEM_NOUN = 'item';

/** source tool id → the SINGULAR noun for one thing that source hands over. */
export const SOURCE_ITEM_NOUNS: Record<string, string> = {
  get_pt_tenders: 'tender',
};

/** The one reader. Anything unmapped — an ai step, an unknown tool, no previous step — is 'item'. */
export function itemNounFor(prevToolId?: string | null): string {
  if (!prevToolId) return GENERIC_ITEM_NOUN;
  return SOURCE_ITEM_NOUNS[prevToolId] ?? GENERIC_ITEM_NOUN;
}
