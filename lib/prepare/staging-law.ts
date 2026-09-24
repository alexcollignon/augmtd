// W13.3 · THE STAGING LAW'S VERSION — a LEAF module (no imports) so client-reachable readers
// (lib/prepare/read.ts) can compare against it without dragging the server graph through
// lib/core/versions.ts. lib/prepare/requirements.ts re-exports it; lib/core/versions.ts reads it there.
/** 1 = W6 (provenance + evidence) — the unstamped era · 2 = W13.1 (the requirement's kind + the dates). */
export const STAGING_LAW_VERSION = 2;
