// Re-export from the new source-agnostic context enrichment engine.
// enrichPlanWithContext replaces enrichPlanWithKB — same signature, same behaviour,
// now searches across all registered context sources (KB, and future: Notion, Slack, CRM).
export { enrichPlanWithContext as enrichPlanWithKB } from '@/lib/context-sources/registry'
