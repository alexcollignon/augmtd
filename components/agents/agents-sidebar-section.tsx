'use client';

import Link from 'next/link';
import { Cog6ToothIcon, PlusIcon } from '@heroicons/react/24/outline';
import { AgentIcon } from './agent-icons';

export interface SidebarAgent {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  conversation_starters?: string[] | null;
  web_enabled?: boolean;
  is_owned_by_me?: boolean;
  owner_name?: string | null;
  shared_with_company?: boolean;
}

const COLOR_MAP: Record<string, string> = {
  indigo:  'bg-indigo-500',
  violet:  'bg-violet-500',
  blue:    'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  rose:    'bg-rose-500',
  neutral: 'bg-neutral-500',
};

interface Props {
  agents: SidebarAgent[];
  activeAgentId: string | null;
  onSelect: (agentId: string | null) => void;
}

export function AgentsSidebarSection({ agents, activeAgentId, onSelect }: Props) {
  const mine = agents.filter(a => a.is_owned_by_me !== false);
  const team = agents.filter(a => a.is_owned_by_me === false);

  function AgentRow({ agent, isTeam }: { agent: SidebarAgent; isTeam?: boolean }) {
    const isActive = activeAgentId === agent.id;
    const colorClass = COLOR_MAP[agent.color] ?? COLOR_MAP.indigo;
    return (
      <div
        key={agent.id}
        className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isActive ? 'bg-neutral-100' : 'hover:bg-neutral-50'
        }`}
        onClick={() => onSelect(agent.id)}
      >
        <div className={`w-5 h-5 rounded-md ${colorClass} flex items-center justify-center flex-shrink-0`}>
          <AgentIcon iconKey={agent.icon} className="w-3 h-3 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className={`block text-[12.5px] truncate ${isActive ? 'text-neutral-900 font-medium' : 'text-neutral-700'}`}>
            {agent.name}
          </span>
          {isTeam && agent.owner_name && (
            <span className="block text-[10.5px] text-neutral-400 truncate">by {agent.owner_name}</span>
          )}
        </div>
        {!isTeam && (
          <Link
            href={`/agents/${agent.id}/edit`}
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-neutral-200 transition-all"
            title="Edit agent"
          >
            <Cog6ToothIcon className="w-3 h-3 text-neutral-400" />
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 pt-2 pb-1 flex-shrink-0">
      {/* Section label */}
      <div className="flex items-center justify-between px-1.5 mb-1">
        <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">Agents</span>
        <Link
          href="/agents/new"
          className="p-1 rounded-md text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
          title="New agent"
        >
          <PlusIcon className="w-3.5 h-3.5" />
        </Link>
      </div>

      {mine.length === 0 && team.length === 0 ? (
        <Link
          href="/agents/new"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Create your first agent
        </Link>
      ) : (
        <div className="space-y-0.5">
          {mine.map((agent) => <AgentRow key={agent.id} agent={agent} />)}

          {team.length > 0 && (
            <>
              <div className="px-1.5 pt-2 pb-0.5">
                <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">Team</span>
              </div>
              {team.map((agent) => <AgentRow key={agent.id} agent={agent} isTeam />)}
            </>
          )}
        </div>
      )}

      <div className="mt-2 border-t border-neutral-100" />
    </div>
  );
}
