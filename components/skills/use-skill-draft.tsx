'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SAVE AS SKILL (W21) — one door, two entry points (the Skills menu's footer, and an answer's quiet
// offer). POST /api/skills/from-conversation drafts the skill; the ONE skill editor
// (components/skills/skill-editor-modal.tsx) opens prefilled; nothing is saved until its Save.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { draftSkillFromConversation, skillsChanged } from '@/components/one/chat-actions';
import { SkillEditorModal, type SkillDraft } from './skill-editor-modal';

export function useSkillDraft(): { open: (roomKey: string) => Promise<void>; busy: boolean; node: React.ReactNode } {
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const open = useCallback(async (roomKey: string) => {
    if (!roomKey) return;
    setBusy(true);
    try {
      const d = await draftSkillFromConversation(roomKey);
      if (d) setDraft({ id: null, name: d.name, when_to_use: d.whenToUse, content: d.instructions, source: 'chat' });
    } finally { setBusy(false); }
  }, []);
  const node = draft && typeof document !== 'undefined'
    ? createPortal(
        <SkillEditorModal
          initial={draft}
          subtitle="Drafted from this conversation — edit it, then save."
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); skillsChanged(); toast.success('Skill saved — Settings → Team'); }}
        />, document.body)
    : null;
  return { open, busy, node };
}
