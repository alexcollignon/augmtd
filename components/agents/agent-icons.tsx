import {
  CpuChipIcon,
  PencilIcon,
  ScaleIcon,
  ChartBarIcon,
  BriefcaseIcon,
  MagnifyingGlassIcon,
  EnvelopeIcon,
  BoltIcon,
  LightBulbIcon,
  WrenchScrewdriverIcon,
  BuildingOffice2Icon,
  DocumentTextIcon,
  ShieldCheckIcon,
  GlobeAltIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';

export type AgentIconKey =
  | 'cpu-chip'
  | 'pencil'
  | 'scale'
  | 'chart-bar'
  | 'briefcase'
  | 'magnifying-glass'
  | 'envelope'
  | 'bolt'
  | 'light-bulb'
  | 'wrench'
  | 'building'
  | 'document'
  | 'shield'
  | 'globe'
  | 'rocket';

export const AGENT_ICONS: Array<{ key: AgentIconKey; Icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { key: 'cpu-chip',         Icon: CpuChipIcon },
  { key: 'pencil',           Icon: PencilIcon },
  { key: 'scale',            Icon: ScaleIcon },
  { key: 'chart-bar',        Icon: ChartBarIcon },
  { key: 'briefcase',        Icon: BriefcaseIcon },
  { key: 'magnifying-glass', Icon: MagnifyingGlassIcon },
  { key: 'envelope',         Icon: EnvelopeIcon },
  { key: 'bolt',             Icon: BoltIcon },
  { key: 'light-bulb',       Icon: LightBulbIcon },
  { key: 'wrench',           Icon: WrenchScrewdriverIcon },
  { key: 'building',         Icon: BuildingOffice2Icon },
  { key: 'document',         Icon: DocumentTextIcon },
  { key: 'shield',           Icon: ShieldCheckIcon },
  { key: 'globe',            Icon: GlobeAltIcon },
  { key: 'rocket',           Icon: RocketLaunchIcon },
];

const ICON_MAP = Object.fromEntries(AGENT_ICONS.map(({ key, Icon }) => [key, Icon])) as Record<AgentIconKey, ComponentType<SVGProps<SVGSVGElement>>>;

export function AgentIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const Icon = ICON_MAP[iconKey as AgentIconKey] ?? CpuChipIcon;
  return <Icon className={className ?? 'w-4 h-4'} />;
}

export const DEFAULT_ICON: AgentIconKey = 'cpu-chip';
