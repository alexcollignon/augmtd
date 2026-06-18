'use client';

import { Fragment, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  CalendarIcon,
  MapPinIcon,
  VideoCameraIcon,
  DocumentTextIcon,
  MicrophoneIcon,
  PencilSquareIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import {
  formatMeetingTime,
  calculateDuration,
  getVIPAttendees,
} from '@/lib/types/meetings';
import { createClient } from '@/lib/supabase/client';
import RsvpButtons from '@/components/inbox/rsvp-buttons';
import MeetingRecorder from '@/components/meetings/meeting-recorder';
import { useRecording } from '@/hooks/useRecording';
import { Button, IconButton } from '@/components/ui';

interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

interface MeetingTranscript {
  id: string;
  title: string;
  transcript_segments: TranscriptSegment[];
  duration_minutes: number;
  work_items_generated: number;
}

interface MeetingDetailPanelProps {
  event: CalendarEvent;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function avatarColor(email: string) {
  const colors = [
    'bg-indigo-100 text-indigo-700',
    'bg-violet-100 text-violet-700',
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function rsvpBadge(status?: string): { label: string; className: string } | null {
  if (!status || status === 'accepted') return null;
  if (status === 'needsAction') return { label: 'Awaiting', className: 'bg-amber-50 text-amber-600' };
  if (status === 'tentative' || status === 'tentativelyaccepted') return { label: 'Maybe', className: 'bg-amber-50 text-amber-600' };
  if (status === 'declined') return { label: 'Declined', className: 'bg-neutral-100 text-neutral-500' };
  return null;
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors flex-shrink-0"
    >
      {copied ? <CheckIcon className="w-3 h-3 text-green-500" /> : <ClipboardDocumentIcon className="w-3 h-3" />}
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}

export default function MeetingDetailPanel({
  event,
  userEmail,
  isOpen,
  onClose,
  onRefresh,
  onEdit,
  onDelete,
}: MeetingDetailPanelProps) {
  const panelRecording = useRecording(() => setTranscriptKey(k => k + 1));
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);
  const vipAttendees = getVIPAttendees(event.attendees);
  const isUpcoming = event.meeting_status !== 'completed';
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptKey, setTranscriptKey] = useState(0);

  useEffect(() => {
    if (!isOpen || (event.meeting_status !== 'completed' && transcriptKey === 0)) {
      setTranscript(null);
      return;
    }
    const fetchTranscript = async () => {
      setTranscriptLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('meeting_transcripts')
          .select('id, title, transcript_segments, duration_minutes, work_items_generated')
          .eq('calendar_event_id', event.id)
          .maybeSingle();
        if (error) { setTranscript(null); }
        else { setTranscript(data); }
      } catch { setTranscript(null); }
      finally { setTranscriptLoading(false); }
    };
    fetchTranscript();
  }, [isOpen, event.id, event.meeting_status, transcriptKey]);

  const handleJoinMeeting = () => {
    if (event.meeting_link) window.open(event.meeting_link, '_blank');
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-in-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in-out duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-neutral-900/20 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full" enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-200"
                leaveFrom="translate-x-0" leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-[400px]">
                  <div className="flex h-full flex-col bg-white shadow-xl">

                    {/* ── Header ── */}
                    <div className="px-5 pt-5 pb-4 border-b border-neutral-100">
                      {/* Actions row */}
                      <div className="flex items-center justify-end gap-1 mb-3">
                        {onEdit && (
                          <IconButton onClick={onEdit} title="Edit">
                            <PencilSquareIcon className="w-4 h-4" />
                          </IconButton>
                        )}
                        {onDelete && (
                          deleteConfirm ? (
                            <div className="flex items-center gap-1.5 mr-1">
                              <span className="text-[11px] text-neutral-400">Delete?</span>
                              <button
                                onClick={async () => {
                                  setIsDeleting(true);
                                  try {
                                    const res = await fetch(`/api/meetings/${event.id}`, { method: 'DELETE' });
                                    if (res.ok) { onDelete(); }
                                    else { toast.error('Failed to delete'); setDeleteConfirm(false); }
                                  } catch { toast.error('Failed to delete'); setDeleteConfirm(false); }
                                  finally { setIsDeleting(false); }
                                }}
                                disabled={isDeleting}
                                className="text-[11px] font-semibold text-red-500 hover:text-red-700 disabled:opacity-50"
                              >
                                {isDeleting ? '…' : 'Yes'}
                              </button>
                              <button onClick={() => setDeleteConfirm(false)} className="text-[11px] text-neutral-400 hover:text-neutral-600">No</button>
                            </div>
                          ) : (
                            <IconButton onClick={() => setDeleteConfirm(true)} title="Delete" tone="danger">
                              <TrashIcon className="w-4 h-4" />
                            </IconButton>
                          )
                        )}
                        <IconButton onClick={onClose}>
                          <XMarkIcon className="w-4 h-4" />
                        </IconButton>
                      </div>

                      {/* Title */}
                      <Dialog.Title className="text-[17px] font-bold text-neutral-900 leading-snug mb-2">
                        {event.title}
                      </Dialog.Title>

                      {/* Date + time */}
                      <div className="flex items-center gap-1.5 text-[13px] text-neutral-500">
                        <CalendarIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{primary} · {duration}min</span>
                      </div>

                      {/* Location */}
                      {event.location && (
                        <div className="flex items-center gap-1.5 mt-1 text-[13px] text-neutral-500">
                          <MapPinIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{event.location}</span>
                        </div>
                      )}

                      {/* Join link */}
                      {event.meeting_link && (
                        <div className="mt-2.5 flex items-center gap-2">
                          <button
                            onClick={handleJoinMeeting}
                            className="flex items-center gap-1.5 text-[13px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
                          >
                            <VideoCameraIcon className="w-3.5 h-3.5" />
                            Join meeting
                          </button>
                          <CopyLinkButton link={event.meeting_link} />
                        </div>
                      )}
                    </div>

                    {/* ── Scrollable body ── */}
                    <div className="flex-1 overflow-y-auto">

                      {/* Attendees */}
                      {event.attendees.length > 0 && (
                        <div className="px-5 py-4 border-b border-neutral-100">
                          <p className="text-[11px] font-medium text-neutral-400 mb-3 uppercase tracking-wide">
                            Attendees ({event.attendees.length})
                          </p>
                          <div className="space-y-2.5">
                            {event.attendees.map((a, idx) => {
                              const label = a.name || a.email;
                              const initial = label[0].toUpperCase();
                              const badge = rsvpBadge(a.status ?? a.responseStatus);
                              return (
                                <div key={idx} className="flex items-center gap-2.5">
                                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-semibold flex-shrink-0 ${avatarColor(a.email)}`}>
                                    {initial}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-medium text-neutral-800 truncate">{label}</div>
                                    {a.name && <div className="text-[11px] text-neutral-400 truncate">{a.email}</div>}
                                  </div>
                                  {a.isVIP && (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 flex-shrink-0">VIP</span>
                                  )}
                                  {badge && (
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {vipAttendees.length > 0 && (
                            <div className="mt-3 text-[11px] text-violet-600 font-medium">
                              ✦ {vipAttendees.length} VIP {vipAttendees.length === 1 ? 'attendee' : 'attendees'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Record in-person */}
                      {(event.meeting_status === 'upcoming' || event.meeting_status === 'in_progress' || event.meeting_status === 'starting_soon') && (
                        <div className="px-5 py-4 border-b border-neutral-100">
                          <p className="text-[11px] font-medium text-neutral-400 mb-2.5 uppercase tracking-wide">Record in-person</p>
                          <MeetingRecorder
                            state={panelRecording.state}
                            elapsed={panelRecording.elapsed}
                            uploadProgress={panelRecording.uploadProgress}
                            errorMessage={panelRecording.errorMessage}
                            onStart={() => panelRecording.startRecording(event.title, event.id)}
                            onPause={panelRecording.pauseRecording}
                            onResume={panelRecording.resumeRecording}
                            onStop={panelRecording.stopAndUpload}
                            onReset={panelRecording.reset}
                          />
                        </div>
                      )}

                      {/* Transcript */}
                      {event.meeting_status === 'completed' && (
                        <div className="px-5 py-4">
                          <p className="text-[11px] font-medium text-neutral-400 mb-2.5 uppercase tracking-wide flex items-center gap-1.5">
                            <DocumentTextIcon className="w-3.5 h-3.5" /> Transcript
                          </p>
                          {transcriptLoading && <p className="text-[12px] text-neutral-400 italic">Loading…</p>}
                          {!transcriptLoading && !transcript && (
                            <p className="text-[12px] text-neutral-400">No transcript yet — will appear after the bot processes the recording.</p>
                          )}
                          {!transcriptLoading && transcript && (
                            <>
                              <div className="flex items-center gap-2 text-[11px] text-neutral-400 mb-3">
                                <span>{transcript.duration_minutes}min</span>
                                {transcript.work_items_generated > 0 && (
                                  <span className="text-indigo-500 font-medium">· {transcript.work_items_generated} action {transcript.work_items_generated === 1 ? 'item' : 'items'}</span>
                                )}
                              </div>
                              <div className="space-y-3 max-h-80 overflow-y-auto bg-neutral-50 rounded-lg p-3">
                                {transcript.transcript_segments.map((seg, idx) => (
                                  <div key={idx} className="text-[12px]">
                                    <span className="font-semibold text-neutral-700">{seg.speaker}</span>
                                    <span className="ml-1.5 text-neutral-400 text-[11px]">{formatTimestamp(seg.timestamp)}</span>
                                    <p className="text-neutral-600 leading-relaxed mt-0.5">{seg.text}</p>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Footer ── */}
                    <div className="border-t border-neutral-100 px-5 py-4 space-y-3 bg-white">
                      <RsvpButtons
                        itemId={event.id}
                        attendees={event.attendees}
                        userEmail={userEmail}
                        onDismiss={(response) => {
                          const labels: Record<string, string> = { accepted: 'Meeting accepted', tentative: 'Marked as maybe', declined: 'Meeting declined' };
                          toast.success(labels[response] ?? 'RSVP updated');
                          onClose();
                          onRefresh?.();
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={onClose}
                          className="flex-1 px-4 py-2 rounded-md text-[13px] font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition-colors"
                        >
                          Close
                        </button>
                        {event.meeting_link && (
                          <Button onClick={handleJoinMeeting} variant="primary" className="flex-1">
                            Join meeting
                          </Button>
                        )}
                      </div>
                    </div>

                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
