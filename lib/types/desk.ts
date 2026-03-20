export type DeskColumn = 'todo' | 'in_progress' | 'waiting' | 'done';
export type DeskSourceType = 'email' | 'meeting_action' | 'process_step' | 'manual';
export type DeskUrgency = 'high' | 'medium' | 'low';

export interface DeskSourceRef {
  type: string;
  id: string;
}

export interface DeskItem {
  id: string;
  userId: string;
  sourceType: DeskSourceType;
  sourceId: string;
  threadKey: string | null;
  sourceRefs: DeskSourceRef[];
  column: DeskColumn;
  position: number;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  urgency: DeskUrgency | null;
  aiContext: string | null;
  synthesis: string | null;
  synthesisAt: string | null;
  emailCount: number;
  hasPrepared: boolean;
  createdAt: string;
  updatedAt: string;
}

export function mapDeskItem(raw: Record<string, unknown>): DeskItem {
  return {
    id: raw.id as string,
    userId: raw.user_id as string,
    sourceType: raw.source_type as DeskSourceType,
    sourceId: raw.source_id as string,
    threadKey: (raw.thread_key as string) ?? null,
    sourceRefs: (raw.source_refs as DeskSourceRef[]) ?? [],
    column: raw.kanban_column as DeskColumn,
    position: raw.position as number,
    title: raw.title as string,
    description: (raw.description as string) ?? null,
    sourceUrl: (raw.source_url as string) ?? null,
    urgency: (raw.urgency as DeskUrgency) ?? null,
    aiContext: (raw.ai_context as string) ?? null,
    synthesis: (raw.synthesis as string) ?? null,
    synthesisAt: (raw.synthesis_at as string) ?? null,
    emailCount: (raw.email_count as number) ?? 1,
    hasPrepared: (raw.has_prepared as boolean) ?? false,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

export const DESK_COLUMNS: { id: DeskColumn; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
];

export const SOURCE_LABELS: Record<DeskSourceType, string> = {
  email: 'Email',
  meeting_action: 'Meeting',
  process_step: 'Process',
  manual: 'Manual',
};
