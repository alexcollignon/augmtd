// ─── Shared tool registry ─────────────────────────────────────────────────────
// All external-data tools live here and are consumed by both the chat route
// and the Studio step executor. Add new tools in this file to make them
// available in both surfaces automatically.

export { webSearchDefinition, executeWebSearch } from './web-search';
export { fetchUrlDefinition, executeFetchUrl } from './fetch-url';
export { rssFeedDefinition, executeRssFeed } from './rss-feed';
export { executeLinkedInPost } from './linkedin-post';
export type { LinkedInPostConfig } from './linkedin-post';
export { executeBrowserFetch } from './browser-fetch';
export { executePtTenders } from './pt-tenders';
export type { PtTendersConfig } from './pt-tenders';
export { executeDeepResearch } from './deep-research';
export type { DeepResearchConfig } from './deep-research';
export { executeWorkflowOutput } from './workflow-output';
export type { WorkflowOutputConfig } from './workflow-output';
export { getEmailsDefinition, executeGetEmails } from './get-emails';
export type { GetEmailsConfig } from './get-emails';
export { getMeetingContextDefinition, executeGetMeetingContext } from './get-meeting-context';
export type { GetMeetingContextConfig } from './get-meeting-context';
export { sendCalendarInviteDefinition, executeSendCalendarInvite } from './send-calendar-invite';
export type { SendCalendarInviteConfig } from './send-calendar-invite';
export { forwardEmailDefinition, executeForwardEmail } from './forward-email';
export type { ForwardEmailConfig } from './forward-email';
export { runComputeDefinition, executeRunCompute } from './compute';
export type { ComputeConfig } from './compute';
export { readActionHistoryDefinition, executeReadActionHistory } from './action-history';
export type { ActionHistoryConfig } from './action-history';
export { deepResearchDefinition } from './deep-research';
export {
  slackListChannelsDefinition, slackPostMessageDefinition, slackReadMessagesDefinition, slackListMembersDefinition,
  executeSlackListChannels, executeSlackPostMessage, executeSlackReadMessages, executeSlackListMembers,
} from './slack';
export {
  findTeamWorkDefinition, readTeamWorkDefinition,
  executeFindTeamWork, executeReadTeamWork,
} from './team-work';
export {
  composeEmailDefinition, executeComposeEmail, sendCoworkerEmail, getUserEmailIdentities, isEmailEnabledForAgent,
} from './coworker-email';
// P6b — the item-action doables (complete/dismiss/resolve/find/remember): ONE executor each, consumed
// by the API routes AND the conversation core AND (by exposure) any agent. Irreversible sends are NOT
// here as committing executors — approve-before-commit is structural.
export {
  resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition,
  executeResolveInboxItem, executeResolveCommitment, executeFindFile, executeRememberFact, inboxItemTitle,
} from './item-actions';
export type { EmailDraft } from './coworker-email';

// OpenAI function-calling format converter — used by chat route
export function toOpenAITool(def: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}) {
  return {
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.input_schema,
    },
  };
}
