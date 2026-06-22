'use client';

// Inline, editable email draft shown in coworker chat. The coworker drafts (compose_email);
// the user edits recipients/subject/body here and clicks Send — sending is user-gated.

import { useState } from 'react';
import { PaperAirplaneIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Input, Textarea, Button } from '@/components/ui';
import { toast } from 'sonner';

export interface EmailDraftData {
  id?: string; to: string[]; cc: string[]; subject: string; body: string; from: string; fromName: string; sent_at?: string;
}

function RecipientRow({ label, list, setList }: { label: string; list: string[]; setList: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  const commit = (raw: string) => {
    const v = raw.trim().replace(/[,;]+$/, '');
    if (v && !list.includes(v)) setList([...list, v]);
    setInput('');
  };
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-neutral-100">
      <span className="text-[11px] text-neutral-400 w-7 pt-1.5 flex-shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1 flex-1">
        {list.map(addr => (
          <span key={addr} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100 text-[12px] text-neutral-700">
            {addr}
            <button onClick={() => setList(list.filter(a => a !== addr))} className="text-neutral-400 hover:text-neutral-600">×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(input); } }}
          onBlur={() => commit(input)}
          placeholder={list.length ? '' : 'email@example.com'}
          className="flex-1 min-w-[120px] bg-transparent text-[12.5px] text-neutral-800 placeholder:text-neutral-400 outline-none py-1"
        />
      </div>
    </div>
  );
}

export function EmailDraftCard({ draft, threadId, agentId }: { draft: EmailDraftData; threadId: string; agentId: string }) {
  const [to, setTo] = useState<string[]>(draft.to ?? []);
  const [cc, setCc] = useState<string[]>(draft.cc ?? []);
  const [subject, setSubject] = useState(draft.subject ?? '');
  const [body, setBody] = useState(draft.body ?? '');
  const [showCc, setShowCc] = useState((draft.cc ?? []).length > 0);
  const [status, setStatus] = useState<'draft' | 'sending' | 'sent'>(draft.sent_at ? 'sent' : 'draft');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (status === 'sent') {
    return (
      <div className="mt-2 max-w-[560px] rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 flex items-center gap-2 text-[12.5px] text-emerald-800">
        <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
        Sent to {to.join(', ')}
      </div>
    );
  }

  async function send() {
    if (to.length === 0) { toast.error('Add at least one recipient.'); return; }
    if (!subject.trim()) { toast.error('Add a subject.'); return; }
    setStatus('sending');
    try {
      const res = await fetch(`/api/work/threads/${threadId}/send-coworker-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, cc, subject, body, agentId, draftId: draft.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? 'Failed to send.'); setStatus('draft'); return; }
      setStatus('sent');
    } catch { toast.error('Failed to send.'); setStatus('draft'); }
  }

  return (
    <div className="mt-2 max-w-[560px] rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-1.5 border-b border-neutral-100 bg-neutral-50/60">
        <span className="text-[11px] text-neutral-400">From </span>
        <span className="text-[12px] text-neutral-600">{draft.fromName} &lt;{draft.from}&gt;</span>
      </div>
      <RecipientRow label="To" list={to} setList={setTo} />
      {showCc && <RecipientRow label="Cc" list={cc} setList={setCc} />}
      <div className="px-3 py-1.5 border-b border-neutral-100">
        <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="border-0 px-0 shadow-none focus:border-0" />
      </div>
      <div className="px-3 py-2">
        <Textarea value={body} onChange={e => setBody(e.target.value)} rows={6} placeholder="Write the email…" className="border-0 px-0 shadow-none resize-y" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-t border-neutral-100">
        {!showCc && <button onClick={() => setShowCc(true)} className="text-[12px] text-neutral-500 hover:text-neutral-700">+ Cc</button>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} disabled={status === 'sending'}>Discard</Button>
          <Button size="sm" onClick={send} disabled={status === 'sending'}>
            <PaperAirplaneIcon className="w-3.5 h-3.5" />
            {status === 'sending' ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
