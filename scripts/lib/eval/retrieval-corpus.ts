// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LABELLED RETRIEVAL SET (scripts/eval-retrieval.ts). ~20 generic documents a small regulated
// firm keeps (contracts, invoices, policies, decks, minutes) in EN/FR/DE/PT/ES, with near-duplicates
// (two MSAs, two invoices to one client), an OLD and a NEW version of the same document, and
// acronym-named files — and ~40 queries, each labelled with the document(s) that answer it.
// Generic fakes only (Acme, Globex, Initech, Umbrella, Northwind, Contoso; Sam, Lee, Ana).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type CorpusDoc = {
  key: string;
  filename: string;
  /** 'pdf' | 'docx' docs are generated as real files; 'txt'/'md' as UTF-8. */
  format: 'txt' | 'md' | 'pdf' | 'docx';
  lang: 'en' | 'fr' | 'de' | 'pt' | 'es';
  /** Days before "now" the file was last modified (version questions read it). */
  ageDays: number;
  text: string;
};

export type CorpusQuery = {
  q: string;
  /** Doc keys that answer the query (any one counts). */
  relevant: string[];
  /** Doc keys that are the WRONG version for this query (version questions only). */
  wrongVersion?: string[];
  kind: 'exact' | 'paraphrase' | 'cross-lingual' | 'acronym' | 'version' | 'content-fact' | 'filename';
  /** Written AFTER the ranking fixes were tuned on the rest, and never tuned on — the honesty check. */
  holdout?: boolean;
};

const clauses = (topic: string, n: number, line: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => `${topic} ${i + 1}. ${line(i + 1)}`).join('\n');

export const CORPUS: CorpusDoc[] = [
  {
    key: 'msa_acme', filename: 'MSA Acme Logistics 2026.pdf', format: 'pdf', lang: 'en', ageDays: 40,
    text: [
      'MASTER SERVICES AGREEMENT', 'Between Contoso Advisory Ltd ("Supplier") and Acme Logistics SA ("Client").',
      'Effective date: 1 February 2026. Initial term: 24 months.',
      clauses('Clause', 12, (i) => `The Supplier shall provide advisory service line ${i} as described in the relevant statement of work, with monthly reporting to the Client's operations director.`),
      'LIABILITY', "The Supplier's aggregate liability under this Agreement is capped at 150% of the fees paid in the twelve months preceding the claim.",
      'TERMINATION', 'Either party may terminate for convenience with 90 days written notice. Termination for material breach requires 30 days to cure.',
      'GOVERNING LAW', 'This Agreement is governed by the laws of Portugal; the courts of Lisbon have exclusive jurisdiction.',
    ].join('\n\n'),
  },
  {
    key: 'msa_globex', filename: 'MSA Globex Retail 2026.pdf', format: 'pdf', lang: 'en', ageDays: 35,
    text: [
      'MASTER SERVICES AGREEMENT', 'Between Contoso Advisory Ltd ("Supplier") and Globex Retail GmbH ("Client").',
      'Effective date: 15 March 2026. Initial term: 12 months, renewing automatically for 12-month periods.',
      clauses('Clause', 12, (i) => `The Supplier shall provide advisory service line ${i} as described in the relevant statement of work, with quarterly reporting to the Client's finance team.`),
      'LIABILITY', "The Supplier's aggregate liability under this Agreement is capped at 100% of the fees paid in the twelve months preceding the claim.",
      'TERMINATION', 'Either party may terminate for convenience with 60 days written notice. Termination for material breach requires 15 days to cure.',
      'GOVERNING LAW', 'This Agreement is governed by the laws of Germany; the courts of Munich have exclusive jurisdiction.',
    ].join('\n\n'),
  },
  {
    key: 'nda_initech', filename: 'NDA Initech mutual.docx', format: 'docx', lang: 'en', ageDays: 120,
    text: 'Mutual Non-Disclosure Agreement between Contoso Advisory Ltd and Initech SARL. Purpose: evaluating a joint bid for a public-sector data migration tender. Confidential information excludes information already public. Obligations survive for 5 years after disclosure. Each party returns or destroys confidential materials within 10 business days of a written request. Signed by Sam for Contoso and by the managing director of Initech on 3 June 2026.',
  },
  {
    key: 'dpa', filename: 'DPA_Acme_v3.pdf', format: 'pdf', lang: 'en', ageDays: 38,
    text: [
      'Data Processing Agreement (Article 28 GDPR)', 'Controller: Acme Logistics SA. Processor: Contoso Advisory Ltd.',
      'Categories of data subjects: employees and drivers of the Controller. Categories of personal data: names, work contact details, shift records.',
      'Sub-processors: the Processor may engage sub-processors only with prior written authorisation; current sub-processors are listed in Annex 3 and are hosted in the European Union.',
      'Personal data breach: the Processor notifies the Controller without undue delay and in any event within 48 hours of becoming aware of a breach.',
      'Retention: personal data is deleted or returned within 30 days after the end of the services.',
    ].join('\n\n'),
  },
  {
    key: 'sow', filename: 'SOW-ACME-07.docx', format: 'docx', lang: 'en', ageDays: 30,
    text: 'Statement of Work 07 under the Acme Logistics master agreement. Scope: redesign of the warehouse slotting process at the Porto distribution centre. Deliverables: current-state assessment (week 3), target design (week 7), pilot playbook (week 10). Fees: fixed price EUR 64,000, invoiced in three milestones of 30%, 40% and 30%. Project lead: Lee. Client sponsor: the Acme operations director.',
  },
  {
    key: 'inv_0417', filename: 'INV-2026-0417 Northwind.pdf', format: 'pdf', lang: 'en', ageDays: 20,
    text: 'INVOICE INV-2026-0417\nContoso Advisory Ltd to Northwind Traders BV\nInvoice date 14 March 2026, due 13 April 2026.\nAdvisory retainer March 2,400.00\nWorkshop facilitation 3 x 450.00 = 1,350.00\nTravel expenses Lisbon 318.75\nReport translation DE-EN 250.00\nSubtotal EUR 4,318.75 · VAT 23% EUR 993.31 · Total due EUR 5,312.06',
  },
  {
    key: 'inv_0388', filename: 'INV-2026-0388 Northwind.pdf', format: 'pdf', lang: 'en', ageDays: 50,
    text: 'INVOICE INV-2026-0388\nContoso Advisory Ltd to Northwind Traders BV\nInvoice date 12 February 2026, due 14 March 2026.\nAdvisory retainer February 2,400.00\nMarket sizing analysis 1,900.00\nTravel expenses Madrid 204.10\nSubtotal EUR 4,504.10 · VAT 23% EUR 1,035.94 · Total due EUR 5,540.04',
  },
  {
    key: 'factura_es', filename: 'Factura F-2026-118 Umbrella.pdf', format: 'pdf', lang: 'es', ageDays: 25,
    text: 'FACTURA F-2026-118\nEmisor: Contoso Advisory Ltd. Cliente: Umbrella Ibérica S.L., Madrid.\nFecha de emisión: 2 de abril de 2026. Vencimiento: 2 de mayo de 2026.\nConcepto: auditoría de procesos de compras, 12 días de consultoría a 950,00 EUR por día.\nBase imponible 11.400,00 EUR · IVA 21% 2.394,00 EUR · Total 13.794,00 EUR.\nForma de pago: transferencia bancaria.',
  },
  {
    key: 'pricing_v1', filename: 'Pricing Policy v1 (2025).pdf', format: 'pdf', lang: 'en', ageDays: 300,
    text: 'Pricing Policy — version 1, approved January 2025.\nStandard hourly rates: partner EUR 280, senior consultant EUR 190, consultant EUR 140, analyst EUR 95.\nDiscounts: up to 10% for engagements above EUR 50,000, approved by a partner.\nExpenses are billed at cost plus 5% handling.\nThis version is superseded when a newer version is approved.',
  },
  {
    key: 'pricing_v2', filename: 'Pricing Policy v2 (2026).pdf', format: 'pdf', lang: 'en', ageDays: 15,
    text: 'Pricing Policy — version 2, approved January 2026.\nStandard hourly rates: partner EUR 310, senior consultant EUR 210, consultant EUR 155, analyst EUR 105.\nDiscounts: up to 8% for engagements above EUR 60,000, approved by two partners.\nExpenses are billed at cost, without handling fees.\nThis version replaces version 1 from 2025.',
  },
  {
    key: 'isp', filename: 'ISP.pdf', format: 'pdf', lang: 'en', ageDays: 90,
    text: [
      'Information Security Policy', 'Scope: all staff, contractors and systems of Contoso Advisory Ltd.',
      clauses('Control', 10, (i) => `Control objective ${i} is reviewed annually by the security officer and evidence is kept for audit for at least three years.`),
      'PASSWORDS AND AUTHENTICATION', 'Passwords must have at least 14 characters. Multi-factor authentication is mandatory for email, the document management system and all client portals. Passwords are never shared, including with IT.',
      'LAPTOPS', 'Laptops use full-disk encryption and lock after 5 minutes of inactivity. A lost device is reported to the security officer within 2 hours.',
      'INCIDENTS', 'Security incidents are reported to security@contoso.example immediately; the incident log is reviewed monthly.',
    ].join('\n\n'),
  },
  {
    key: 'te_policy', filename: 'T&E Policy.md', format: 'md', lang: 'en', ageDays: 80,
    text: '# Travel and Expense Policy\n\n- Economy class for flights under 6 hours; premium economy above.\n- Hotel cap: EUR 160 per night in Lisbon and Porto, EUR 220 in London and Paris.\n- Meal allowance: EUR 45 per day when travelling.\n- Expense claims are submitted within 30 days with receipts.\n- Mileage for private cars is reimbursed at EUR 0.36 per km.',
  },
  {
    key: 'okr', filename: 'OKRs 2026 H1.md', format: 'md', lang: 'en', ageDays: 60,
    text: '# Objectives and Key Results — first half 2026\n\nObjective 1: grow recurring advisory revenue.\n- KR1: sign 4 new retainers above EUR 3,000 per month.\n- KR2: net revenue retention of 110%.\n\nObjective 2: become the reference for logistics process work in Iberia.\n- KR1: publish 2 case studies.\n- KR2: speak at 3 industry events.\n\nObjective 3: healthy team — eNPS above 40.',
  },
  {
    key: 'board_deck', filename: 'Q3 Board Deck.pdf', format: 'pdf', lang: 'en', ageDays: 10,
    text: '## Slide 1\nQ3 2026 board meeting\n## Slide 2\nRevenue Q3: EUR 1.42 million, up 18% year on year\n## Slide 3\nPipeline: 11 qualified opportunities worth EUR 2.9 million\n## Slide 4\nHeadcount: 23 people, 2 open roles (senior consultant, data analyst)\n## Slide 5\nRisks: concentration — the top client is 31% of revenue\n## Slide 6\nAsk: approve the opening of a Madrid office in Q1 2027',
  },
  {
    key: 'minutes', filename: 'Minutes partners meeting 2026-09-08.txt', format: 'txt', lang: 'en', ageDays: 23,
    text: 'Partners meeting — 8 September 2026. Present: Sam, Lee, Ana.\n1. The partners agreed to raise the bonus pool to 9% of profit.\n2. The Madrid office decision moves to the Q3 board meeting.\n3. Ana will own the renewal of the Globex contract and report by 30 September.\n4. The firm will stop accepting new public-sector tenders until the bid team is staffed.',
  },
  {
    key: 'contrat_fr', filename: 'Contrat de prestation Initech.pdf', format: 'pdf', lang: 'fr', ageDays: 70,
    text: "CONTRAT DE PRESTATION DE SERVICES\nEntre Contoso Advisory Ltd (le Prestataire) et Initech SARL, Lyon (le Client).\nObjet : accompagnement à la réorganisation de la chaîne d'approvisionnement.\nDurée : six mois à compter du 1er mai 2026.\nHonoraires : forfait de 48 000 EUR hors taxes, payable en deux échéances.\nRésiliation : chaque partie peut résilier avec un préavis de 45 jours.\nLoi applicable : droit français, tribunaux de Lyon.",
  },
  {
    key: 'rahmen_de', filename: 'Rahmenvertrag Umbrella GmbH.docx', format: 'docx', lang: 'de', ageDays: 110,
    text: 'RAHMENVERTRAG ÜBER BERATUNGSLEISTUNGEN\nZwischen Contoso Advisory Ltd und Umbrella GmbH, Hamburg.\nLaufzeit: unbefristet, kündbar mit einer Frist von drei Monaten zum Quartalsende.\nVergütung: Tagessatz 1.150 EUR netto; Reisekosten nach Aufwand.\nHaftung: begrenzt auf den Auftragswert des jeweiligen Einzelauftrags.\nGerichtsstand: Hamburg.',
  },
  {
    key: 'ferias_pt', filename: 'Política de férias.docx', format: 'docx', lang: 'pt', ageDays: 140,
    text: 'POLÍTICA DE FÉRIAS\nTodos os colaboradores têm direito a 25 dias úteis de férias por ano civil.\nOs pedidos de férias são submetidos com pelo menos 30 dias de antecedência e aprovados pelo responsável de equipa.\nNo máximo 10 dias podem transitar para o ano seguinte, a gozar até 30 de abril.\nEm agosto, pelo menos metade da equipa deve estar disponível.',
  },
  {
    key: 'remote_policy', filename: 'Remote Work Policy.docx', format: 'docx', lang: 'en', ageDays: 200,
    text: 'Remote Work Policy. Employees may work remotely up to 3 days per week. Core hours are 10:00 to 16:00 Lisbon time. The equipment allowance is EUR 450 per year. Working from another country for more than 20 days a year requires approval from the People team because of tax and social security rules.',
  },
  {
    key: 'onboarding', filename: 'Client onboarding checklist.md', format: 'md', lang: 'en', ageDays: 45,
    text: '# Client onboarding checklist\n\n1. Run the KYC check on the client entity and its beneficial owners.\n2. Sign the engagement letter and the DPA where personal data is processed.\n3. Create the client workspace and the shared folder.\n4. Schedule the kickoff within 10 business days of signature.',
  },
];

export const QUERIES: CorpusQuery[] = [
  // exact / filename-shaped
  { q: 'Q3 board deck', relevant: ['board_deck'], kind: 'filename' },
  { q: 'SOW-ACME-07', relevant: ['sow'], kind: 'filename' },
  { q: 'INV-2026-0388', relevant: ['inv_0388'], kind: 'filename' },
  { q: 'remote work policy', relevant: ['remote_policy'], kind: 'exact' },
  { q: 'client onboarding checklist', relevant: ['onboarding'], kind: 'exact' },
  // acronyms
  { q: 'DPA', relevant: ['dpa'], kind: 'acronym' },
  { q: 'the ISP', relevant: ['isp'], kind: 'acronym' },
  { q: 'T&E policy', relevant: ['te_policy'], kind: 'acronym' },
  { q: 'our OKRs for this half', relevant: ['okr'], kind: 'acronym' },
  { q: 'NDA with Initech', relevant: ['nda_initech'], kind: 'acronym' },
  { q: 'MSA with Globex', relevant: ['msa_globex'], kind: 'acronym' },
  // paraphrase
  { q: 'data processing agreement with Acme', relevant: ['dpa'], kind: 'paraphrase' },
  { q: 'information security policy', relevant: ['isp'], kind: 'paraphrase' },
  { q: 'how many days of holiday do employees get', relevant: ['ferias_pt'], kind: 'paraphrase' },
  { q: 'travel and expenses rules for hotels', relevant: ['te_policy'], kind: 'paraphrase' },
  { q: 'statement of work for the warehouse slotting redesign', relevant: ['sow'], kind: 'paraphrase' },
  { q: 'master services agreement with Acme Logistics', relevant: ['msa_acme'], kind: 'paraphrase' },
  { q: 'confidentiality agreement for the joint public tender bid', relevant: ['nda_initech'], kind: 'paraphrase' },
  { q: 'decisions from the last partners meeting', relevant: ['minutes'], kind: 'paraphrase' },
  // content facts (the answer is in the body, not the name)
  { q: 'which invoice charged 318.75 for travel to Lisbon', relevant: ['inv_0417'], kind: 'content-fact' },
  { q: 'notice period to terminate the Globex agreement for convenience', relevant: ['msa_globex'], kind: 'content-fact' },
  { q: 'liability cap of 150% of fees', relevant: ['msa_acme'], kind: 'content-fact' },
  { q: 'minimum password length and MFA requirement', relevant: ['isp'], kind: 'content-fact' },
  { q: 'within how many hours must the processor notify a data breach', relevant: ['dpa'], kind: 'content-fact' },
  { q: 'who owns the Globex renewal', relevant: ['minutes'], kind: 'content-fact' },
  { q: 'Madrid office proposal', relevant: ['board_deck', 'minutes'], kind: 'content-fact' },
  { q: 'mileage reimbursement rate per km', relevant: ['te_policy'], kind: 'content-fact' },
  // cross-lingual
  { q: 'French services contract with Initech in Lyon', relevant: ['contrat_fr'], kind: 'cross-lingual' },
  { q: 'Umbrella framework agreement day rate', relevant: ['rahmen_de'], kind: 'cross-lingual' },
  { q: 'vacation policy carry over days', relevant: ['ferias_pt'], kind: 'cross-lingual' },
  { q: 'Spanish invoice for the procurement audit', relevant: ['factura_es'], kind: 'cross-lingual' },
  { q: 'préavis de résiliation du contrat Initech', relevant: ['contrat_fr'], kind: 'cross-lingual' },
  { q: 'Kündigungsfrist Rahmenvertrag Umbrella', relevant: ['rahmen_de'], kind: 'cross-lingual' },
  { q: 'política de segurança da informação palavras-passe', relevant: ['isp'], kind: 'cross-lingual' },
  { q: 'factura de Umbrella Ibérica', relevant: ['factura_es'], kind: 'cross-lingual' },
  // versions (the current one unless a version is named)
  { q: 'pricing policy', relevant: ['pricing_v2'], wrongVersion: ['pricing_v1'], kind: 'version' },
  { q: 'what is our current hourly rate for a senior consultant', relevant: ['pricing_v2'], wrongVersion: ['pricing_v1'], kind: 'version' },
  { q: 'latest rate card', relevant: ['pricing_v2'], wrongVersion: ['pricing_v1'], kind: 'version' },
  { q: 'discount rules for large engagements', relevant: ['pricing_v2'], wrongVersion: ['pricing_v1'], kind: 'version' },
  { q: 'pricing policy v1 from 2025', relevant: ['pricing_v1'], wrongVersion: ['pricing_v2'], kind: 'version' },
  // near-duplicates
  { q: 'February invoice to Northwind', relevant: ['inv_0388'], kind: 'content-fact' },
  // ── HOLDOUT (Oct 1): written after the fixes, never tuned on ──
  { q: 'which contract gives the Lisbon courts jurisdiction', relevant: ['msa_acme'], kind: 'content-fact', holdout: true },
  { q: 'how long do the NDA obligations last', relevant: ['nda_initech'], kind: 'content-fact', holdout: true },
  { q: 'Annex 3 sub-processors', relevant: ['dpa'], kind: 'content-fact', holdout: true },
  { q: 'fixed price paid in three milestones', relevant: ['sow'], kind: 'paraphrase', holdout: true },
  { q: 'IVA 21%', relevant: ['factura_es'], kind: 'cross-lingual', holdout: true },
  { q: 'eNPS target', relevant: ['okr'], kind: 'acronym', holdout: true },
  { q: 'what to do when a laptop is lost', relevant: ['isp'], kind: 'paraphrase', holdout: true },
  { q: 'bonus pool percentage agreed by the partners', relevant: ['minutes'], kind: 'content-fact', holdout: true },
  { q: 'Gerichtsstand Hamburg', relevant: ['rahmen_de'], kind: 'cross-lingual', holdout: true },
  { q: 'headcount and open roles', relevant: ['board_deck'], kind: 'content-fact', holdout: true },
  { q: 'working from another country for more than 20 days', relevant: ['remote_policy'], kind: 'content-fact', holdout: true },
  { q: 'when should the client kickoff happen after signature', relevant: ['onboarding'], kind: 'content-fact', holdout: true },
  { q: 'our 2025 hourly rates', relevant: ['pricing_v1'], wrongVersion: ['pricing_v2'], kind: 'version', holdout: true },
  { q: 'Northwind invoice for March', relevant: ['inv_0417'], kind: 'content-fact', holdout: true },
];
