-- W15.4 A PROMISE IS QUOTED OR IT ISN'T A PROMISE (docs/stabilization-plan.md · docs/laws-registry.md
-- `a-promise-is-quoted`). Every extracted commitment carries the EXACT words of its source message that
-- make it — code-verified at the write door (lib/commitments/extract.ts promiseQuoteFloor) and served
-- by the one source reader (lib/commitments/source.ts sourceQuoteOf) so the item says WHY it exists.
-- The commitments table has no jsonb metadata column, so the quote gets its own nullable column.
-- Code works BEFORE this lands: the writer retries without the column; the reader treats the error as
-- "no quote". Pre-W15.4 rows stay NULL (scripts/repair-unquoted-promises.ts can re-check them).
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS source_quote TEXT;
