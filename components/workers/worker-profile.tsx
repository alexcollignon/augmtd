'use client';

import React, { useState, useCallback } from 'react';
import type { ChatMessage } from '@/components/work/chat-message';
import {
  ChatBubbleLeftRightIcon,
  BookOpenIcon,
  BoltIcon,
  DocumentTextIcon,
  ClockIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { WorkerChatTab } from '@/components/workers/tabs/worker-chat-tab';
import { WorkerKnowledgeTab } from '@/components/workers/tabs/worker-knowledge-tab';
import { WorkerActivityTab } from '@/components/workers/tabs/worker-activity-tab';
import { WorkerTasksTab } from '@/components/workers/tabs/worker-tasks-tab';
import { WorkerDocumentsTab } from '@/components/workers/tabs/worker-documents-tab';
import { WorkerToolsTab } from '@/components/workers/tabs/worker-tools-tab';
import { TabBar } from '@/components/ui';
import type { Worker, WorkerThread } from '@/app/workers/workers-page-client';

type Tab = 'chat' | 'knowledge' | 'tasks' | 'tools' | 'documents' | 'activity';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'chat',      label: 'Chat',      icon: ChatBubbleLeftRightIcon },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpenIcon },
  { id: 'tasks',     label: 'Tasks',     icon: BoltIcon },
  { id: 'tools',     label: 'Tools',     icon: WrenchScrewdriverIcon },
  { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
  { id: 'activity',  label: 'Activity',  icon: ClockIcon },
];

interface WorkerProfileProps {
  worker: Worker;
  initialThreads: WorkerThread[];
  initialMessages?: ChatMessage[];
  initialTab?: Tab;
  initialThreadId?: string | null;
  onTabChange?: (tab: string) => void;
  onActiveThreadChange?: (threadId: string | null) => void;
  onThreadCreated?: (thread: WorkerThread) => void;
  onThreadDeleted?: (threadId: string) => void;
}

export function WorkerProfile({ worker, initialThreads, initialMessages, initialTab, initialThreadId, onTabChange, onActiveThreadChange, onThreadCreated, onThreadDeleted }: WorkerProfileProps) {
  const validInitialTab = initialTab && ['chat','knowledge','tasks','tools','documents','activity'].includes(initialTab) ? initialTab : 'chat';
  const [activeTab, setActiveTab] = useState<Tab>(validInitialTab);
  // Track which tabs have been visited so they stay mounted (lazy-mount, keep-alive)
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(new Set([validInitialTab]));
  const [jumpThreadId, setJumpThreadId] = useState<string | null>(null);
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setMountedTabs(prev => prev.has(tab) ? prev : new Set([...prev, tab]));
    onTabChange?.(tab);
  }

  const handleOpenInChat = useCallback((threadId: string) => {
    setJumpThreadId(threadId);
    setActiveTab('chat');
  }, []);

  const handleJumpConsumed = useCallback(() => {
    setJumpThreadId(null);
  }, []);

  const handleNewVersion = useCallback((title: string) => {
    setChatPrefill(`Revise "${title}": `);
    setActiveTab('chat');
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm">

      {/* Tab bar */}
      <div className="flex-shrink-0 pt-1">
        <TabBar tabs={TABS} active={activeTab} onChange={handleTabChange} />
      </div>

      {/* Tab content — lazy-mount on first visit, then keep alive with CSS hide */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {mountedTabs.has('chat') && (
          <div className={activeTab === 'chat' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <WorkerChatTab
              key={`chat-${worker.id}`}
              worker={worker}
              initialThreads={initialThreads}
              initialMessages={initialMessages}
              initialThreadId={initialThreadId}
              jumpThreadId={jumpThreadId}
              onJumpConsumed={handleJumpConsumed}
              onActiveThreadChange={onActiveThreadChange}
              onThreadCreated={onThreadCreated}
              onThreadDeleted={onThreadDeleted}
              initialInputValue={chatPrefill}
              onInitialInputConsumed={() => setChatPrefill(null)}
            />
          </div>
        )}
        {mountedTabs.has('knowledge') && (
          <div className={activeTab === 'knowledge' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <WorkerKnowledgeTab
              key={`knowledge-${worker.id}`}
              workerId={worker.id}
              workerName={worker.name}
            />
          </div>
        )}
        {mountedTabs.has('tasks') && (
          <div className={activeTab === 'tasks' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <WorkerTasksTab
              key={`tasks-${worker.id}`}
              workerId={worker.id}
              workerName={worker.name}
              isActive={activeTab === 'tasks'}
              onOpenInChat={handleOpenInChat}
            />
          </div>
        )}
        {mountedTabs.has('tools') && (
          <div className={activeTab === 'tools' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <WorkerToolsTab
              key={`tools-${worker.id}`}
              workerId={worker.id}
              workerName={worker.name}
            />
          </div>
        )}
        {mountedTabs.has('documents') && (
          <div className={activeTab === 'documents' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <WorkerDocumentsTab
              key={`documents-${worker.id}`}
              workerId={worker.id}
              workerName={worker.name}
              onOpenInChat={handleOpenInChat}
              onNewVersion={handleNewVersion}
            />
          </div>
        )}
        {mountedTabs.has('activity') && (
          <div className={activeTab === 'activity' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <WorkerActivityTab
              key={`activity-${worker.id}`}
              workerId={worker.id}
              workerName={worker.name}
              onOpenInChat={handleOpenInChat}
            />
          </div>
        )}
      </div>
    </div>
  );
}
