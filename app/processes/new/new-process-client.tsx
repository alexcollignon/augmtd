'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import type { ProcessPlan } from '@/lib/types/process';
import {
  PaperAirplaneIcon,
  UserCircleIcon,
  CpuChipIcon,
  ArrowRightIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';

interface Props {
  userEmail: string;
}

interface TeamMember {
  id: string;
  full_name: string;
  role: string;
  department?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';
const THINKING_OPEN = '<THINKING>';

/**
 * Returns what to show in the chat bubble from the accumulated streamed text.
 * - Strips complete and in-progress <THINKING>...</THINKING> blocks
 * - Clips at the JSON/separator boundary
 */
function getDisplayText(full: string): string {
  // Strip completed thinking blocks
  let text = full.replace(/<THINKING>[\s\S]*?<\/THINKING>\n?/g, '');

  // If a thinking block has opened but not yet closed, hide from <THINKING> onward
  const openIdx = text.indexOf(THINKING_OPEN);
  if (openIdx !== -1) text = text.slice(0, openIdx);

  // Clip at separator or JSON start
  const sepIdx = text.indexOf(PLAN_SEPARATOR);
  if (sepIdx !== -1) return text.slice(0, sepIdx).trim();

  // Fallback: clip at a JSON block containing "steps"
  const jsonMatch = text.match(/(\n|^)\{/);
  if (jsonMatch && jsonMatch.index !== undefined) {
    const fromIdx = jsonMatch.index + (text[jsonMatch.index] === '\n' ? 1 : 0);
    const tail = text.slice(fromIdx);
    if (tail.includes('"steps"') && tail.includes('"description"')) {
      return text.slice(0, fromIdx).trim();
    }
  }

  return text.trim();
}

/**
 * Returns true once we've hit the point where no more conversational text will appear.
 */
function hasReachedJson(full: string): boolean {
  if (full.includes(PLAN_SEPARATOR)) return true;
  const jsonMatch = full.match(/(\n|^)\{/);
  if (jsonMatch && jsonMatch.index !== undefined) {
    const tail = full.slice(jsonMatch.index);
    if (tail.includes('"steps"') && tail.includes('"description"')) return true;
  }
  return false;
}

/**
 * Extract the JSON plan text from a completed response.
 */
function extractPlanJson(full: string): string | null {
  const sepIdx = full.indexOf(PLAN_SEPARATOR);
  if (sepIdx !== -1) {
    const raw = full.slice(sepIdx + PLAN_SEPARATOR.length).trim();
    return raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim() || null;
  }
  const jsonMatch = full.match(/(\{[\s\S]*"steps"[\s\S]*\})\s*$/);
  return jsonMatch ? jsonMatch[1].trim() : null;
}

function StepTypeIcon({ type }: { type: 'human' | 'generator' }) {
  if (type === 'generator') return <CpuChipIcon className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />;
  return <UserCircleIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />;
}

export function NewProcessClient({ userEmail }: Props) {
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

  useEffect(() => {
    fetch('/api/company/members')
      .then(r => r.json())
      .then(d => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
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

        // Always update the bubble with the display text (thinking + JSON stripped)
        setChat(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: displayText };
          return updated;
        });
      }

      // After stream completes: parse and apply the plan
      const jsonText = extractPlanJson(full);
      if (jsonText && jsonText !== 'null') {
        try {
          const parsed = JSON.parse(jsonText) as ProcessPlan;
          if (parsed?.steps?.length) {
            setPlan(parsed);
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
  }, [input, streaming, chat, title]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const reassignStep = (stepIndex: number, value: string) => {
    if (!plan) return;
    if (value === '__dept__') {
      // Keep department, clear assignee_id
      setPlan({
        ...plan,
        steps: plan.steps.map(s =>
          s.step_index === stepIndex ? { ...s, assignee_id: undefined } : s
        ),
      });
      return;
    }
    const member = teamMembers.find(m => m.id === value);
    setPlan({
      ...plan,
      steps: plan.steps.map(s =>
        s.step_index === stepIndex
          ? { ...s, assignee_id: value, department: member?.department }
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
      const { process } = await createRes.json();

      await fetch(`/api/processes/${process.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });

      const launchRes = await fetch(`/api/processes/${process.id}/launch`, { method: 'POST' });
      if (!launchRes.ok) {
        const err = await launchRes.json();
        throw new Error(err.error ?? 'Failed to launch');
      }

      router.push(`/processes/${process.id}`);
    } catch (err) {
      alert('Launch failed: ' + String(err));
      setLaunching(false);
    }
  };

  const unassignedCount = plan?.steps.filter(s => !s.assignee_id && !s.department).length ?? 0;

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <SidebarNav userEmail={userEmail} />

      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Center: Plan Preview */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-neutral-200 bg-white">
          <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-100">
            <h2 className="text-[13px] font-semibold text-neutral-700">Process Plan</h2>
            <p className="text-[11px] text-neutral-400 mt-0.5">AI will build a collaborative plan based on your description</p>
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
              <div className="space-y-4">
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
                  <p className="text-[12px] text-neutral-600 bg-neutral-50 rounded px-3 py-2">{plan.description}</p>
                )}

                {planUpdating && (
                  <div className="flex items-center gap-2 text-[11px] text-indigo-500">
                    <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                    Updating plan...
                  </div>
                )}

                {/* Metadata */}
                <div className="flex gap-4 text-[11px] text-neutral-500">
                  <span>{plan.steps.length} steps</span>
                  {plan.estimated_total_days && <span>~{plan.estimated_total_days} days</span>}
                  <span>{new Set(plan.steps.map(s => s.assignee_id ?? s.department).filter(Boolean)).size} people/teams</span>
                  {unassignedCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <ExclamationCircleIcon className="w-3.5 h-3.5" />
                      {unassignedCount} unassigned
                    </span>
                  )}
                </div>

                {/* Steps — assignee picker on every card */}
                <div>
                  <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                    STEPS ({plan.steps.length})
                  </h3>
                  <div className="space-y-2">
                    {plan.steps.map((step, i) => {
                      const isUnassigned = !step.assignee_id && !step.department;
                      return (
                        <div
                          key={step.step_index}
                          className={`flex gap-3 p-3 border rounded ${
                            isUnassigned
                              ? 'border-amber-200 bg-amber-50'
                              : 'border-neutral-100 bg-neutral-50'
                          }`}
                        >
                          {/* Step number */}
                          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-[10px] font-semibold text-neutral-500 mt-0.5">
                            {i + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Title row */}
                            <div className="flex items-center gap-1.5">
                              <StepTypeIcon type={step.step_type} />
                              <span className="text-[12px] font-medium text-neutral-800 leading-snug">{step.title}</span>
                            </div>

                            {/* Description */}
                            {step.description && (
                              <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{step.description}</p>
                            )}

                            {/* Bottom row: assignee picker + meta */}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {/* Assignee select — always visible */}
                              <select
                                value={step.assignee_id ?? '__dept__'}
                                onChange={e => reassignStep(step.step_index, e.target.value)}
                                className={`text-[11px] border rounded px-2 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                                  isUnassigned
                                    ? 'border-amber-300 text-amber-700'
                                    : 'border-neutral-200 text-neutral-700'
                                }`}
                              >
                                {/* Dept / unassigned option */}
                                <option value="__dept__">
                                  {step.department ? `${step.department} (dept)` : 'Unassigned'}
                                </option>
                                {teamMembers.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.full_name}{m.department ? ` · ${m.department}` : ''}
                                  </option>
                                ))}
                              </select>

                              {step.estimated_days && (
                                <span className="text-[10px] text-neutral-400">~{step.estimated_days}d</span>
                              )}
                              {step.input_type && (
                                <span className="text-[10px] text-neutral-400 capitalize">{step.input_type}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Launch */}
                <div className="pt-2">
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
                </div>
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

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chat.length === 0 && (
              <p className="text-[11px] text-neutral-400 italic">
                Tell me about a multi-step process your team needs to run — I'll create a plan with assignments.
              </p>
            )}
            {chat.map((msg, i) => (
              <div key={i} className={`text-[12px] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div className={`inline-block max-w-[90%] px-3 py-2 rounded text-left whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-neutral-100 text-neutral-800'
                }`}>
                  {msg.content || (streaming && i === chat.length - 1 ? (
                    <span className="flex items-center gap-1.5 text-neutral-400">
                      <ArrowPathIcon className="w-3 h-3 animate-spin" />
                      Thinking...
                    </span>
                  ) : '')}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="flex-shrink-0 px-4 py-3 border-t border-neutral-100">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your process..."
                rows={2}
                className="flex-1 border border-neutral-200 rounded px-3 py-2 text-[12px] resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className="self-end p-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
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
