'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SKILL EDITOR — ONE editor for every door that writes a skill: the Settings → Team library
// (new · edit · import · the interview's draft) and, since W21, "Save as skill" in a chat (the
// conversation's draft, prefilled). It owns its own save, so a chat and the library cannot save a
// skill two different ways. Nothing is written until the user presses the save button.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, IconButton, Input, Textarea } from '@/components/ui';

export type SkillDraft = {
  id: string | null; name: string; when_to_use: string; content: string;
  source?: string; kind?: string | null; assignWorkerIds?: string[];
};

export const EMPTY_SKILL_DRAFT: SkillDraft = { id: null, name: '', when_to_use: '', content: '' };

/** Write a draft through the skills doors (voice drafts route to the voice profile). True on success. */
export async function saveSkillDraft(draft: SkillDraft): Promise<boolean> {
  const name = draft.name.trim();
  const content = draft.content.trim();
  if (!name || !content) return false;
  // Voice lives in Memory, not the skills library. A new voice-kind draft (from the
  // interview) routes to the user's durable voice profile instead of becoming a skill.
  if (!draft.id && draft.kind === 'voice') {
    const r = await fetch('/api/context/voice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    });
    if (r.ok) toast.success('Saved to your voice — Settings → Memory');
    return r.ok;
  }
  const payload = { name, when_to_use: draft.when_to_use.trim() || null, content, source: draft.source ?? 'manual', kind: draft.kind ?? null };
  if (draft.id) {
    const r = await fetch(`/api/skills/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return r.ok;
  }
  const res = await fetch('/api/skills', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  // Assign the workers picked during the interview pre-qual to the new skill.
  const created = await res.json().catch(() => null);
  const newId = created?.skill?.id;
  if (newId && draft.assignWorkerIds?.length) {
    await Promise.all(draft.assignWorkerIds.map((agentId) =>
      fetch(`/api/skills/${newId}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, assigned: true }),
      }).catch(() => {})));
  }
  return res.ok;
}

export function SkillEditorModal({ initial, onClose, onSaved, subtitle }: {
  initial: SkillDraft;
  onClose: () => void;
  onSaved?: () => void;
  /** One quiet line under the title (the chat door says where the draft came from). */
  subtitle?: string;
}) {
  const [draft, setDraft] = useState<SkillDraft>(initial);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const ok = await saveSkillDraft(draft);
      if (ok) onSaved?.();
      else toast.error("Couldn't save the skill — try again.");
    } finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !isSaving && onClose()}>
      <div
        className="w-full max-w-[560px] rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-neutral-800">{draft.id ? 'Edit skill' : 'New skill'}</h2>
            {subtitle && <p className="mt-0.5 text-[11.5px] text-neutral-400">{subtitle}</p>}
          </div>
          <IconButton onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </IconButton>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">Name</label>
            <Input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Client report format"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">
              Use when <span className="text-neutral-400 font-normal">— optional, helps the worker pick the right skill</span>
            </label>
            <Input
              value={draft.when_to_use}
              onChange={e => setDraft({ ...draft, when_to_use: e.target.value })}
              placeholder="e.g. When writing a client report"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">Instructions</label>
            <Textarea
              value={draft.content}
              onChange={e => setDraft({ ...draft, content: e.target.value })}
              rows={9}
              placeholder={`The rules the worker should follow when this applies. e.g.\n\n- Lead with the recommendation, then the rationale\n- One page max; cite every figure\n- UK English, metric units\n- No jargon or filler`}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-neutral-100 bg-neutral-50">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !draft.name.trim() || !draft.content.trim()}
          >
            {isSaving ? 'Saving…' : draft.id ? 'Save changes' : 'Create skill'}
          </Button>
        </div>
      </div>
    </div>
  );
}
