'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import type { ProcessPlan } from '@/lib/types/process';
import {
  PaperAirplaneIcon,
  ArrowRightIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import { StepTypeIcon, AssigneePicker, TeamMember, ChatMessage, getDisplayText, hasReachedJson, extractPlanJson, PLAN_SEPARATOR } from '@/app/processes/_components/plan-components';
import { ProcessSidebar } from '@/app/processes/_components/process-sidebar';

interface Props {
  userEmail: string;
  userId: string;
}

export function NewProcessClient({ userEmail, userId }: Props) {
  const router = useRouter();
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [planUpdating, setPlanUpdating] = useState(false);
  const [plan, setPlan] = useState<ProcessPlan | null>(null);
  const [title, setTitle] = useState('');
  const [launching, setLaunching] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Track original AI suggestions (first plan parse only — never updated on user edits)
  const originalSuggestionsRef = useRef<Record<number, string | null>>({});

  useEffect(() => {
    fetch('/api/company/members')
      .then(r => r.json())
      .then(d => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const sendMessageWith = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || streaming) return;
    setInput('');
    setChat(prev => [...prev, { role: 'user', content: userMsg }]);
    setStreaming(true);

    const history = chat.map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/processes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history }),
      });

      if (!res.ok || !res.body) {
        setChat(prev => [...prev, { role: 'assistant', content: 'Error connecting to AI. Please try again.' }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let jsonStarted = false;

      setChat(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });

        const displayText = getDisplayText(full);
        if (!jsonStarted && hasReachedJson(full)) {
          jsonStarted = true;
          setPlanUpdating(true);
        }
        setChat(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: displayText };
          return updated;
        });
      }

      const jsonText = extractPlanJson(full);
      if (jsonText && jsonText !== 'null') {
        try {
          const parsed = JSON.parse(jsonText) as ProcessPlan;
          if (parsed?.steps?.length) {
            setPlan(parsed);
            if (Object.keys(originalSuggestionsRef.current).length === 0) {
              const suggestions: Record<number, string | null> = {};
              parsed.steps.forEach(s => { suggestions[s.step_index] = s.assignee_id ?? null; });
              originalSuggestionsRef.current = suggestions;
            }
            if (!title && parsed.description) {
              setTitle(parsed.description.slice(0, 80));
            }
          }
        } catch {
          // ignore parse failure
        }
      }
      setPlanUpdating(false);
    } catch (err) {
      setChat(prev => [...prev, { role: 'assistant', content: 'Error: ' + String(err) }]);
    } finally {
      setStreaming(false);
    }
  }, [streaming, chat, title]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(() => {
    if (!input.trim() || streaming) return;
    const msg = input.trim();
    setInput('');
    sendMessageWith(msg);
  }, [input, streaming, sendMessageWith]);

  const reassignStep = (stepIndex: number, memberId: string | null) => {
    if (!plan) return;
    const member = memberId ? teamMembers.find(m => m.id === memberId) : null;
    setPlan({
      ...plan,
      steps: plan.steps.map(s =>
        s.step_index === stepIndex
          ? { ...s, assignee_id: memberId ?? undefined, department: member?.department }
          : s
      ),
    });
  };

  const launchProcess = async () => {
    if (!plan || !title.trim() || launching) return;
    setLaunching(true);
    try {
      const createRes = await fetch('/api/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: plan.description }),
      });
      if (!createRes.ok) throw new Error('Failed to create process');
      const { process: proc } = await createRes.json();

      await fetch(`/api/processes/${proc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });

      const launchRes = await fetch(`/api/processes/${proc.id}/launch`, { method: 'POST' });
      if (!launchRes.ok) {
        const err = await launchRes.json();
        throw new Error(err.error ?? 'Failed to launch');
      }

      router.push(`/processes/${proc.id}`);
    } catch (err) {
      alert('Launch failed: ' + String(err));
      setLaunching(false);
    }
  };

  const assignedCount = plan?.steps.filter(s => s.assignee_id || s.department).length ?? 0;
  const totalSteps = plan?.steps.length ?? 0;
  const allAssigned = totalSteps > 0 && assignedCount === totalSteps;
  const processReady = allAssigned && title.trim().length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <SidebarNav userEmail={userEmail} />
      <ProcessSidebar userId={userId} />

      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Center: Plan Preview */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-neutral-200 bg-white">
          <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-100">
            <h2 className="text-[13px] font-semibold text-neutral-700">New Process</h2>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Describe your process in the chat — AI will build a collaborative plan with team assignments
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {planUpdating && !plan ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <ArrowPathIcon className="w-6 h-6 text-indigo-400 animate-spin mx-auto mb-2" />
                  <p className="text-[12px] text-neutral-500">Building your plan...</p>
                </div>
              </div>
            ) : !plan ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-sm">
                  <ArrowRightIcon className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
                  <p className="text-[13px] text-neutral-500">Describe your process in the chat</p>
                  <p className="text-[11px] text-neutral-400 mt-1">
                    E.g. "Onboard a new client: collect docs, legal review, finance approval, welcome email"
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Title */}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Process title</label>
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Name this process..."
                    className="w-full border border-neutral-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>

                {plan.description && (
                  <p className="text-[12px] text-neutral-600 bg-neutral-50 rounded px-3 py-2 leading-relaxed">
                    {plan.description}
                  </p>
                )}

                {planUpdating && (
                  <div className="flex items-center gap-2 text-[11px] text-indigo-500">
                    <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                    Updating plan...
                  </div>
                )}

                {/* INPUTS NEEDED checklist */}
                <div className="border border-neutral-200 rounded p-3">
                  <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                    INPUTS NEEDED
                  </h3>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <CheckCircleSolid className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span className="text-neutral-600">Process description</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      {allAssigned ? (
                        <CheckCircleSolid className="w-4 h-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <CheckCircleIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                      )}
                      <span className={allAssigned ? 'text-neutral-600' : 'text-amber-600'}>
                        Team assignments ({assignedCount}/{totalSteps} steps assigned)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Metadata row */}
                <div className="flex gap-4 text-[11px] text-neutral-500 flex-wrap">
                  <span>{totalSteps} steps</span>
                  {plan.estimated_total_days && <span>~{plan.estimated_total_days} days</span>}
                  <span>
                    {new Set(plan.steps.map(s => s.assignee_id ?? s.department).filter(Boolean)).size} people/teams
                  </span>
                </div>

                {/* Steps with custom assignee picker */}
                <div>
                  <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                    STEPS ({totalSteps})
                  </h3>
                  <div className="space-y-2">
                    {plan.steps.map((step, i) => {
                      const isUnassigned = !step.assignee_id && !step.department;
                      const originalSuggestion = originalSuggestionsRef.current[step.step_index] ?? null;

                      return (
                        <div
                          key={step.step_index}
                          className={`flex gap-3 p-3 border rounded ${
                            isUnassigned ? 'border-amber-200 bg-amber-50' : 'border-neutral-100 bg-neutral-50'
                          }`}
                        >
                          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-[10px] font-semibold text-neutral-500 mt-0.5">
                            {i + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <StepTypeIcon type={step.step_type} />
                              <span className="text-[12px] font-medium text-neutral-800 leading-snug">{step.title}</span>
                            </div>
                            {step.description && (
                              <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{step.description}</p>
                            )}

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <AssigneePicker
                                step={step}
                                teamMembers={teamMembers}
                                originalSuggestion={originalSuggestion}
                                onAssign={(memberId) => reassignStep(step.step_index, memberId)}
                              />
                              {(step.estimated_days ?? 0) > 0 && (
                                <span className="text-[10px] text-neutral-400">~{step.estimated_days}d</span>
                              )}
                              {step.input_type && (
                                <span className="text-[10px] text-neutral-400 capitalize">{step.input_type}</span>
                              )}
                              {isUnassigned && (
                                <span className="flex items-center gap-1 text-[10px] text-amber-600">
                                  <ExclamationCircleIcon className="w-3.5 h-3.5" />
                                  Unassigned
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* EXPECTED OUTCOMES */}
                {plan.expected_outcomes && plan.expected_outcomes.length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                      EXPECTED OUTCOMES
                    </h3>
                    <div className="space-y-1.5">
                      {plan.expected_outcomes.map((o, i) => (
                        <div key={i} className="flex items-start gap-2 text-[12px]">
                          {o.type === 'risk' ? (
                            <ExclamationTriangleIcon className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                          ) : (
                            <LightBulbIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                          )}
                          <span className="text-neutral-600 leading-relaxed">{o.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Process ready banner / Launch button */}
                {processReady ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded text-[12px] text-green-700">
                      <CheckCircleSolid className="w-4 h-4 flex-shrink-0" />
                      Process ready — all steps assigned and title set.
                    </div>
                    <button
                      onClick={launchProcess}
                      disabled={launching}
                      className="w-full py-2.5 bg-indigo-600 text-white text-[13px] font-medium rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {launching ? 'Launching...' : 'Launch Process'}
                    </button>
                  </div>
                ) : (
                  <div className="pt-1">
                    <button
                      onClick={launchProcess}
                      disabled={launching || !title.trim()}
                      className="w-full py-2.5 bg-indigo-600 text-white text-[13px] font-medium rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {launching ? 'Launching...' : 'Launch Process'}
                    </button>
                    {!title.trim() && (
                      <p className="text-[11px] text-neutral-400 text-center mt-1">Add a title above to launch</p>
                    )}
                    {title.trim() && !allAssigned && (
                      <p className="text-[11px] text-amber-600 text-center mt-1">
                        {totalSteps - assignedCount} step{totalSteps - assignedCount !== 1 ? 's' : ''} still need assignment
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: AI Chat */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white">
          <div className="flex-shrink-0 px-4 py-3 border-b border-neutral-100">
            <h3 className="text-[12px] font-semibold text-neutral-700">AI Assistant</h3>
            <p className="text-[11px] text-neutral-400">Describe your process to get started</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {chat.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>
                {[
                  'Onboard a new hire',
                  'Client contract approval',
                  'Quarterly financial close',
                  'Product launch checklist',
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => sendMessageWith(prompt)}
                    className="text-left px-3 py-2 text-[12px] text-neutral-600 border border-neutral-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            {chat.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[80%] px-3 py-2 bg-indigo-600 text-white text-[13px] leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                    {msg.content || (streaming && i === chat.length - 1 ? (
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    ) : null)}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
            <div className="flex items-end gap-2 px-3 py-3">
              <textarea
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (sendMessage(), (e.target as HTMLTextAreaElement).style.height = 'auto')}
                placeholder="Describe your process..."
                disabled={streaming}
                rows={1}
                className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
                style={{ maxHeight: '160px', overflowY: 'auto' }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 disabled:text-neutral-300 transition-colors"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
