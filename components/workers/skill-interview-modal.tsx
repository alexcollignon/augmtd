'use client';

import { useState } from 'react';
import { SparklesIcon, XMarkIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, Input, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';

interface RosterWorker { id: string; name: string; worker_role: string | null }

export interface InterviewDraft {
  name: string;
  when_to_use: string;
  content: string;
  kind: string | null;
  source: string;
  assignWorkerIds: string[];
}

interface Props {
  workers: RosterWorker[];
  onClose: () => void;
  onDraft: (draft: InterviewDraft) => void;
}

type Question = { id: string; question: string; hint: string; placeholder: string };
type Stage = 'prequal' | 'loadingQuestions' | 'questions' | 'synthesizing';

const KINDS = [
  { value: 'voice', label: 'Voice / tone', hint: 'How you sound' },
  { value: 'domain', label: 'Business / context', hint: 'Facts about your business, product, market' },
  { value: 'audience', label: 'Audience', hint: 'Who you write for' },
  { value: 'method', label: 'Method / format', hint: 'How to structure a kind of output' },
];

export function SkillInterviewModal({ workers, onClose, onDraft }: Props) {
  const [stage, setStage] = useState<Stage>('prequal');
  const [error, setError] = useState<string | null>(null);

  // pre-qual
  const [objective, setObjective] = useState('');
  const [kind, setKind] = useState<string>('');
  const [samples, setSamples] = useState('');
  const [assignIds, setAssignIds] = useState<string[]>([]);

  // interview
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const toggleWorker = (id: string) =>
    setAssignIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function startInterview() {
    if (!objective.trim() || stage === 'loadingQuestions') return;
    setError(null);
    setStage('loadingQuestions');
    try {
      const res = await fetch('/api/skills/interview/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: objective.trim(), kind: kind || undefined, hasSamples: !!samples.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.questions?.length) throw new Error(data.error || 'No questions');
      setQuestions(data.questions);
      setStage('questions');
    } catch {
      setError('Could not generate the interview. You can still write the skill manually.');
      setStage('prequal');
    }
  }

  async function buildSkill() {
    if (stage === 'synthesizing') return;
    setError(null);
    setStage('synthesizing');
    try {
      const res = await fetch('/api/skills/interview/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: objective.trim(),
          kind: kind || undefined,
          answers: questions.map((q) => ({ question: q.question, answer: answers[q.id] ?? '' })),
          samples: samples.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.draft) throw new Error(data.error || 'Failed');
      onDraft({
        name: data.draft.name,
        when_to_use: data.draft.when_to_use ?? '',
        content: data.draft.content,
        kind: data.draft.kind ?? (kind || null),
        source: 'interview',
        assignWorkerIds: assignIds,
      });
    } catch {
      setError('Could not build the skill. Try again, or edit your answers.');
      setStage('questions');
    }
  }

  const answeredCount = questions.filter((q) => (answers[q.id] ?? '').trim()).length;
  const busy = stage === 'loadingQuestions' || stage === 'synthesizing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && onClose()}>
      <div
        className="w-full max-w-[600px] rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            {stage === 'questions' && (
              <button onClick={() => setStage('prequal')} className="text-neutral-400 hover:text-neutral-600" title="Back">
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
            )}
            <SparklesIcon className="w-4 h-4 text-indigo-500" />
            <h2 className="text-[14px] font-semibold text-neutral-800">
              {stage === 'questions' ? 'A few questions' : 'Build a skill'}
            </h2>
          </div>
          <IconButton onClick={onClose} disabled={busy}><XMarkIcon className="w-5 h-5" /></IconButton>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {error && <p className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* ── Pre-qual ───────────────────────────────────────── */}
          {(stage === 'prequal' || stage === 'loadingQuestions') && (
            <>
              <p className="text-[12.5px] text-neutral-500 -mt-1">
                Answer a few questions and your coworker will write the skill for you — no blank page.
              </p>
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">What should this skill capture?</label>
                <Input
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="e.g. my LinkedIn voice · my business context · how I write exec summaries"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">What kind is it? <span className="text-neutral-400 font-normal">— optional</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.value}
                      onClick={() => setKind(kind === k.value ? '' : k.value)}
                      className={cn(
                        'text-left rounded-lg border px-3 py-2 transition-colors',
                        kind === k.value ? 'border-indigo-300 bg-indigo-50' : 'border-neutral-200 hover:bg-neutral-50',
                      )}
                    >
                      <div className="text-[12.5px] font-medium text-neutral-800">{k.label}</div>
                      <div className="text-[11px] text-neutral-400 mt-0.5">{k.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">
                  {kind === 'voice' ? 'Paste 2–3 things you wrote that sound like you' : 'Examples'}{' '}
                  <span className="text-neutral-400 font-normal">— optional{kind === 'voice' ? ', but strongly recommended for voice' : ''}</span>
                </label>
                <Textarea
                  value={samples}
                  onChange={(e) => setSamples(e.target.value)}
                  rows={4}
                  placeholder={kind === 'voice' ? 'Paste past posts, emails, or anything in your voice…' : 'Paste any examples that help…'}
                />
              </div>
              {workers.length > 0 && (
                <div>
                  <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">Assign to <span className="text-neutral-400 font-normal">— optional</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {workers.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => toggleWorker(w.id)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-[12px] transition-colors',
                          assignIds.includes(w.id) ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50',
                        )}
                      >
                        {w.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Interview questions ────────────────────────────── */}
          {(stage === 'questions' || stage === 'synthesizing') && (
            <>
              <p className="text-[12.5px] text-neutral-500 -mt-1">
                Answer what you can — skip anything that doesn&apos;t fit. {answeredCount}/{questions.length} answered.
              </p>
              {questions.map((q, i) => (
                <div key={q.id}>
                  <label className="block text-[12.5px] font-medium text-neutral-700 mb-1">
                    {i + 1}. {q.question}
                  </label>
                  {q.hint && <p className="text-[11px] text-neutral-400 mb-1.5">{q.hint}</p>}
                  <Textarea
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    rows={2}
                    placeholder={q.placeholder || 'Your answer…'}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-neutral-100 bg-neutral-50">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          {(stage === 'prequal' || stage === 'loadingQuestions') && (
            <Button onClick={startInterview} disabled={!objective.trim() || busy}>
              {stage === 'loadingQuestions' ? 'Preparing…' : 'Start interview'}
            </Button>
          )}
          {(stage === 'questions' || stage === 'synthesizing') && (
            <Button onClick={buildSkill} disabled={busy}>
              {stage === 'synthesizing' ? 'Building…' : 'Build skill'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
