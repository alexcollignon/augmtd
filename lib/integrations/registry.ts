// ─── Integration registry ─────────────────────────────────────────────────────
// The catalogue of connectable integrations (Nango-backed). `provider` is the
// Nango provider-config-key. Wave 1: Slack + Notion. Add an entry here + a tool
// executor to ship a new one.

export type IntegrationScope = 'user' | 'company';

export interface IntegrationDef {
  provider: string;       // Nango provider_config_key
  name: string;
  description: string;
  scopesNote: string;     // human-readable grant summary shown on the Connect card
  scope: IntegrationScope; // 'company' = one shared install per workspace (e.g. Slack)
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    provider: 'slack',
    name: 'Slack',
    description: 'Your coworkers post updates and read channels — as themselves, through one shared workspace app.',
    scopesNote: 'Connected once for your whole team. Post messages (as each coworker) and list channels.',
    scope: 'company',
  },
  // Notion deferred — will get its own scope decision when we build it.
];

export const INTEGRATION_PROVIDERS = INTEGRATIONS.map(i => i.provider);

export function getIntegration(provider: string): IntegrationDef | undefined {
  return INTEGRATIONS.find(i => i.provider === provider);
}

export function isKnownProvider(p: string): boolean {
  return INTEGRATION_PROVIDERS.includes(p);
}
