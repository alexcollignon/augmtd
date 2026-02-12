'use client';

import { useState } from 'react';
import {
  UserIcon,
  UsersIcon,
  DocumentCheckIcon,
  CheckCircleIcon,
  EyeIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

interface RecipientContextDisplayProps {
  recipientContext: any;
  otherRecipients?: string[];
}

export default function RecipientContextDisplay({ recipientContext, otherRecipients = [] }: RecipientContextDisplayProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showSignals, setShowSignals] = useState(false);

  if (!recipientContext) return null;

  const {
    detectedRole,
    position,
    wasExplicitlyMentioned,
    workSignals,
    inferredWorkState,
    responsibilityConfidence,
    confidenceBreakdown,
    reasoning,
  } = recipientContext;

  // Get role display
  const getRoleDisplay = (role: string) => {
    switch (role) {
      case 'primary_owner':
        return {
          icon: UserIcon,
          label: 'Primary Owner',
          description: 'Main person responsible for this task',
          color: 'bg-blue-100 text-blue-700 border-blue-200',
        };
      case 'secondary_owner':
        return {
          icon: UsersIcon,
          label: 'Co-Owner',
          description: 'Shared responsibility',
          color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        };
      case 'reviewer':
        return {
          icon: DocumentCheckIcon,
          label: 'Reviewer',
          description: 'Asked to review or approve',
          color: 'bg-purple-100 text-purple-700 border-purple-200',
        };
      case 'approver':
        return {
          icon: CheckCircleIcon,
          label: 'Approver',
          description: 'Final decision maker',
          color: 'bg-green-100 text-green-700 border-green-200',
        };
      case 'informed':
        return {
          icon: EyeIcon,
          label: 'Informed (FYI)',
          description: 'CC\'d for awareness only',
          color: 'bg-gray-100 text-gray-600 border-gray-200',
        };
      default:
        return {
          icon: UserIcon,
          label: role,
          description: '',
          color: 'bg-gray-100 text-gray-600 border-gray-200',
        };
    }
  };

  const roleDisplay = getRoleDisplay(detectedRole);
  const RoleIcon = roleDisplay.icon;
  const confidencePercent = Math.round(responsibilityConfidence * 100);

  // Get confidence color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-green-600';
    if (confidence >= 40) return 'text-yellow-600';
    return 'text-orange-600';
  };

  // Format active signals
  const getActiveSignals = () => {
    if (!workSignals) return [];

    const signals = [];
    if (workSignals.hasObligation) signals.push(`Obligation (${workSignals.obligationStrength}%)`);
    if (workSignals.requiresJudgment) signals.push(`Judgment (${workSignals.judgmentComplexity}%)`);
    if (workSignals.requiresDecision) signals.push('Decision required');
    if (workSignals.hasDeadline) signals.push(`Deadline (${workSignals.deadlineUrgency}%)`);
    if (workSignals.isTaskAssignment) signals.push('Task assignment');
    if (workSignals.isNegotiation) signals.push('Negotiation');
    if (workSignals.requiresApproval) signals.push('Requires approval');
    if (workSignals.isDelegation) signals.push('Delegation');
    if (workSignals.informationalOnly) signals.push('Informational only');

    return signals;
  };

  const activeSignals = getActiveSignals();

  return (
    <div className="space-y-4">
      {/* Recipient Role Card */}
      <div className={`border rounded-lg p-4 ${roleDisplay.color}`}>
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <RoleIcon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{roleDisplay.label}</h4>
              <div className="flex items-center space-x-2">
                {position && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-white bg-opacity-50">
                    {position.toUpperCase()}
                  </span>
                )}
                {wasExplicitlyMentioned && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-white bg-opacity-50">
                    📧 Mentioned
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs mt-1 opacity-80">{roleDisplay.description}</p>

            {/* Confidence Score */}
            <div className="mt-3 flex items-center space-x-2">
              <span className="text-xs font-medium">Confidence:</span>
              <div className="flex-1 bg-white bg-opacity-30 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-current opacity-60"
                  style={{ width: `${confidencePercent}%` }}
                />
              </div>
              <span className={`text-xs font-bold ${getConfidenceColor(confidencePercent)}`}>
                {confidencePercent}%
              </span>
            </div>

            {/* AI Reasoning */}
            {reasoning && (
              <p className="text-xs mt-2 opacity-70 italic">
                "{reasoning}"
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Other Recipients */}
      {otherRecipients.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <UsersIcon className="w-4 h-4 text-gray-500" />
            <span className="text-xs font-medium text-gray-700">
              Also sent to:
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {otherRecipients.map((email, i) => (
              <span
                key={i}
                className="px-2 py-1 text-[10px] bg-white border border-gray-200 rounded text-gray-600"
              >
                {email}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Work Signals */}
      {activeSignals.length > 0 && (
        <div className="border border-gray-200 rounded-lg">
          <button
            onClick={() => setShowSignals(!showSignals)}
            className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <SparklesIcon className="w-4 h-4 text-purple-500" />
              <span className="text-xs font-medium text-gray-700">
                Work Signals ({activeSignals.length})
              </span>
            </div>
            {showSignals ? (
              <ChevronUpIcon className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDownIcon className="w-4 h-4 text-gray-400" />
            )}
          </button>

          {showSignals && (
            <div className="px-3 pb-3 space-y-1">
              {activeSignals.map((signal, i) => (
                <div
                  key={i}
                  className="flex items-center space-x-2 text-xs text-gray-600"
                >
                  <span className="w-1 h-1 rounded-full bg-purple-400" />
                  <span>{signal}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confidence Breakdown */}
      {confidenceBreakdown && (
        <div className="border border-gray-200 rounded-lg">
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
          >
            <span className="text-xs font-medium text-gray-700">
              Confidence Breakdown
            </span>
            {showBreakdown ? (
              <ChevronUpIcon className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDownIcon className="w-4 h-4 text-gray-400" />
            )}
          </button>

          {showBreakdown && (
            <div className="px-3 pb-3 space-y-2">
              <ConfidenceFactor
                label="AI Detection"
                value={confidenceBreakdown.baseAI}
              />
              <ConfidenceFactor
                label="Email Position"
                value={confidenceBreakdown.position}
              />
              <ConfidenceFactor
                label="Work Signals"
                value={confidenceBreakdown.userBehavior}
              />
              {confidenceBreakdown.mentioned !== 1.0 && (
                <ConfidenceFactor
                  label="Mentioned"
                  value={confidenceBreakdown.mentioned}
                />
              )}
              <div className="pt-2 mt-2 border-t border-gray-200">
                <ConfidenceFactor
                  label="Final Confidence"
                  value={confidenceBreakdown.final}
                  isFinal
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceFactor({
  label,
  value,
  isFinal = false,
}: {
  label: string;
  value: number;
  isFinal?: boolean;
}) {
  const percent = Math.round(value * 100);
  const getColor = (p: number) => {
    if (p >= 70) return 'bg-green-500';
    if (p >= 40) return 'bg-yellow-500';
    return 'bg-orange-500';
  };

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className={isFinal ? 'font-semibold text-gray-900' : 'text-gray-600'}>
          {label}
        </span>
        <span className={isFinal ? 'font-bold text-gray-900' : 'text-gray-500'}>
          {percent}%
        </span>
      </div>
      <div className="bg-gray-200 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full ${getColor(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
