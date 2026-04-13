import Image from 'next/image';

interface MeetingAssistantCardProps {
  isEnabled: boolean;
  selfHostedConfigured?: boolean;
}

export default function MeetingAssistantCard({
  isEnabled,
  selfHostedConfigured = false,
}: MeetingAssistantCardProps) {
  if (!selfHostedConfigured) {
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
          <Image src="/logos/attendee.svg" alt="Meeting Assistant" width={18} height={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-neutral-900">Meeting Assistant</p>
          <p className="text-[11px] text-neutral-400">
            Set <code className="bg-neutral-100 px-1 py-0.5 font-mono text-[10px] rounded">MEETING_BOT_SERVICE_URL</code> to enable
          </p>
        </div>
        <span className="text-[11px] text-neutral-400">Not configured</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
        <Image src="/logos/attendee.svg" alt="Meeting Assistant" width={18} height={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-neutral-900">Meeting Assistant</p>
        <p className="text-[11px] text-neutral-400">
          {isEnabled
            ? 'Auto-joins your Google Meet calls and captures transcripts'
            : 'Disabled by your administrator'}
        </p>
      </div>
      <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
        isEnabled ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'
      }`}>
        {isEnabled ? 'Active' : 'Inactive'}
      </span>
    </div>
  );
}
