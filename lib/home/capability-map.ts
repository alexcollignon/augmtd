// ════════════════════════════════════════════════════════════════════════════════════════════════
// RE-EXPORT SHIM (proactive-team W1 — the registry merge). The capability map moved into the ONE
// registry module, `lib/work/surface-registry.ts`, so the judge's verb space and the execution
// character live side by side and can never drift. Every existing importer keeps working through
// this shim; new code should import from the registry directly.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export {
  PLAN_VERSION,
  CAPABILITY_MAP,
  capabilitiesFor,
  isIrreversibleCapability,
  isDirectRunnableCapability,
  coarseCapabilityKind,
  proposeOwner,
  renderCapabilitySet,
} from '@/lib/work/surface-registry';

export type {
  Capability,
  CapabilityKind,
  CapabilityExposure,
  ProposedOwner,
} from '@/lib/work/surface-registry';
