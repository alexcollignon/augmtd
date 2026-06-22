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
    description: 'Each coworker posts and DMs as themselves through their own Slack app — distinct identities, separate DMs.',
    scopesNote: 'Connected once for your whole team (one app per coworker). Posts, DMs, and reads channels.',
    scope: 'company',
  },
  // Notion deferred — will get its own scope decision when we build it.
];

export const INTEGRATION_PROVIDERS = INTEGRATIONS.map(i => i.provider);

// ── Slack: one display integration, one Slack app per coworker ───────────────
// Distinct bot identities → separate DM threads + real @mentions. Each coworker
// role maps to its own Nango provider-config-key (one Slack app each).
export const SLACK_APP_BY_ROLE: Record<string, string> = {
  personal_assistant: 'slack-clara',
  content_manager:    'slack-sofia',
  linkedin_drafter:   'slack-luca',
  research_analyst:   'slack-max',
};
export const SLACK_APP_KEYS = Object.values(SLACK_APP_BY_ROLE);
export const SLACK_DEFAULT_APP_KEY = 'slack-clara'; // agent-less posts default to Clara

export function isSlackProviderKey(p: string): boolean {
  return p === 'slack' || SLACK_APP_KEYS.includes(p);
}
export function slackKeyForRole(role: string | null | undefined): string {
  return (role && SLACK_APP_BY_ROLE[role]) || SLACK_DEFAULT_APP_KEY;
}

// ─── Coworker email identities (Resend, OAuth-free) ───────────────────────────
// Each coworker sends from its own address on the dedicated domain.
export const COWORKER_EMAIL_DOMAIN = process.env.COWORKER_EMAIL_DOMAIN || 'team.augmtd.ai';
export const EMAIL_LOCAL_BY_ROLE: Record<string, string> = {
  personal_assistant: 'clara',
  content_manager:    'sofia',
  linkedin_drafter:   'luca',
  research_analyst:   'max',
};
export function coworkerEmailForRole(role: string | null | undefined): string {
  const local = (role && EMAIL_LOCAL_BY_ROLE[role]) || 'team';
  return `${local}@${COWORKER_EMAIL_DOMAIN}`;
}

export function getIntegration(provider: string): IntegrationDef | undefined {
  const found = INTEGRATIONS.find(i => i.provider === provider);
  if (found) return found;
  // Per-coworker Slack app keys resolve to the shared Slack def (company scope).
  if (SLACK_APP_KEYS.includes(provider)) return INTEGRATIONS.find(i => i.provider === 'slack');
  return undefined;
}

export function isKnownProvider(p: string): boolean {
  return INTEGRATION_PROVIDERS.includes(p) || SLACK_APP_KEYS.includes(p);
}
