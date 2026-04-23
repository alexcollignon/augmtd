'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { MyWorkspace, WorkspaceFeatures } from '@/lib/workspace/types';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';

interface WorkspaceContextValue {
  workspace: MyWorkspace | null;
  allWorkspaces: MyWorkspace[];
  features: WorkspaceFeatures;
  isSuperAdmin: boolean;
}

const defaultValue: WorkspaceContextValue = {
  workspace: null,
  allWorkspaces: [],
  features: DEFAULT_FEATURES,
  isSuperAdmin: false,
};

const WorkspaceContext = createContext<WorkspaceContextValue>(defaultValue);

export function WorkspaceProvider({
  workspace,
  allWorkspaces,
  isSuperAdmin,
  children,
}: {
  workspace: MyWorkspace | null;
  allWorkspaces: MyWorkspace[];
  isSuperAdmin: boolean;
  children: ReactNode;
}) {
  const value: WorkspaceContextValue = {
    workspace,
    allWorkspaces,
    features: workspace?.features ?? DEFAULT_FEATURES,
    isSuperAdmin,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export function useFeatures(): WorkspaceFeatures {
  return useContext(WorkspaceContext).features;
}
