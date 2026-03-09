/**
 * Quality brief for Excel spreadsheet generation.
 * Injected into the Claude Haiku system prompt in generate-pipeline.ts.
 * Adapted from Anthropic's xlsx skill: https://github.com/anthropics/skills/tree/main/skills/xlsx
 */
export const XLSX_SKILL = `
SPREADSHEET QUALITY RULES (follow exactly):

SHEET STRUCTURE:
- 1-2 sheets maximum
- First sheet: the primary data or analysis
- Second sheet (if needed): summary, assumptions, or a different cut of the data
- Sheet names: short and descriptive (1-2 words, e.g. "Revenue", "Summary", "Tracker")

HEADERS:
- Column headers: 1-3 words, title-case, specific ("Q1 Revenue" not "Col1" or "Data")
- If a column contains currency, note the unit in the header ("Revenue ($k)", "Cost (USD)")
- If a column contains years, write them as text strings ("2024", "2025") not numbers
- First column is usually the row label/name — keep it descriptive

ROWS & DATA:
- Row labels in the first column must be distinct — no duplicate row names
- Numbers should be consistent precision within a column (all integers OR all 1-decimal)
- Empty cells: use null — do not write "N/A", "TBD", "-" as string values (null renders as blank)
- Include a totals or summary row at the bottom when the data is additive (sums, counts, averages)
- Totals row label: "Total" or "Average" — always the last row

DATA QUALITY:
- Every number must come from the source material — never invent figures
- Percentages: express as decimals (0.15 for 15%) OR as formatted strings ("15%") — be consistent
- Sort rows logically: chronological for time series, descending value for rankings, alphabetical for lists
- Maximum 20 rows per sheet — if more data exists, summarize or group into categories

WHAT TO AVOID:
- Never output a sheet with only headers and no data rows
- Never repeat the same value in every row of a column — it adds no value
- Do not create columns that are entirely empty or null
- Avoid overly long string values (keep under 50 characters per cell)
`.trim();
