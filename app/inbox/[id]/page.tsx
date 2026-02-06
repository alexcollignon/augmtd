import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import InboxActions from '@/components/inbox/inbox-actions';

export default async function InboxDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch inbox item
  const { data: item, error } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (error || !item) {
    notFound();
  }

  const sourceData = item.source_data;

  const urgencyColors = {
    low: 'bg-gray-100 text-gray-800',
    medium: 'bg-blue-100 text-blue-800',
    high: 'bg-orange-100 text-orange-800',
    critical: 'bg-red-100 text-red-800'
  };

  const urgencyColor = urgencyColors[sourceData?.urgency as keyof typeof urgencyColors] || urgencyColors.medium;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <h1 className="text-2xl font-bold text-primary-600">AUGMTD</h1>
              <Link href="/inbox" className="text-gray-600 hover:text-gray-900 text-sm">
                ← Back to Inbox
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user.email}</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${urgencyColor}`}>
                  {sourceData?.urgency || 'medium'}
                </span>
                {item.priority >= 75 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                    High Priority
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">
                {sourceData?.subject || 'No subject'}
              </h1>
              <p className="text-sm text-gray-600">
                From: <span className="font-medium">{sourceData?.from_name || sourceData?.from}</span>
              </p>
            </div>
          </div>

          {/* Summary */}
          {sourceData?.summary && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Summary</h3>
              <p className="text-gray-900">{sourceData.summary}</p>
            </div>
          )}

          {/* Key Points */}
          {sourceData?.keyPoints && sourceData.keyPoints.length > 0 && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Key Points</h3>
              <ul className="list-disc list-inside space-y-1">
                {sourceData.keyPoints.map((point: string, index: number) => (
                  <li key={index} className="text-gray-900">{point}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Deadline */}
          {sourceData?.deadline && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Deadline</h3>
              <p className="text-gray-900">⏰ {sourceData.deadline}</p>
            </div>
          )}
        </div>

        {/* Action Items */}
        {sourceData?.actionItems && sourceData.actionItems.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">📋 Action Items</h2>
            <div className="space-y-3">
              {sourceData.actionItems.map((action: any, index: number) => (
                <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                  <input type="checkbox" className="mt-1" />
                  <div className="flex-1">
                    <p className="text-gray-900 font-medium">{action.description}</p>
                    <div className="flex items-center space-x-4 mt-1 text-xs text-gray-600">
                      {action.deadline && <span>⏰ {action.deadline}</span>}
                      {action.estimatedTime && <span>⏱️ {action.estimatedTime}</span>}
                    </div>
                    {action.preparedLink && (
                      <a href={action.preparedLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:text-primary-700 mt-1 inline-block">
                        🔗 Open link
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Draft Reply */}
        {sourceData?.draftReply && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">✉️ Draft Reply</h2>
              <span className="text-xs text-gray-600">Tone: {sourceData.draftReply.tone}</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Subject</label>
                <p className="mt-1 text-gray-900">{sourceData.draftReply.subject}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Body</label>
                <div className="mt-1 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900">
                    {sourceData.draftReply.body}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Calendar Event */}
        {sourceData?.calendarEvent && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">📅 Suggested Calendar Event</h2>
            <div className="space-y-2">
              <div>
                <span className="text-sm font-medium text-gray-700">Title:</span>
                <span className="ml-2 text-gray-900">{sourceData.calendarEvent.title}</span>
              </div>
              {sourceData.calendarEvent.date && (
                <div>
                  <span className="text-sm font-medium text-gray-700">Date:</span>
                  <span className="ml-2 text-gray-900">{sourceData.calendarEvent.date}</span>
                </div>
              )}
              {sourceData.calendarEvent.duration && (
                <div>
                  <span className="text-sm font-medium text-gray-700">Duration:</span>
                  <span className="ml-2 text-gray-900">{sourceData.calendarEvent.duration}</span>
                </div>
              )}
              <div>
                <span className="text-sm font-medium text-gray-700">Description:</span>
                <p className="mt-1 text-gray-900">{sourceData.calendarEvent.description}</p>
              </div>
            </div>
          </div>
        )}

        {/* Extracted Data */}
        {sourceData?.extractedData && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">🔍 Extracted Information</h2>
            <div className="grid grid-cols-2 gap-4">
              {sourceData.extractedData.people && sourceData.extractedData.people.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">People</h4>
                  <div className="flex flex-wrap gap-2">
                    {sourceData.extractedData.people.map((person: string, index: number) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-blue-50 text-blue-700">
                        👤 {person}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {sourceData.extractedData.companies && sourceData.extractedData.companies.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Companies</h4>
                  <div className="flex flex-wrap gap-2">
                    {sourceData.extractedData.companies.map((company: string, index: number) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-green-50 text-green-700">
                        🏢 {company}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {sourceData.extractedData.amounts && sourceData.extractedData.amounts.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Amounts</h4>
                  <div className="flex flex-wrap gap-2">
                    {sourceData.extractedData.amounts.map((amount: string, index: number) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-purple-50 text-purple-700">
                        💰 {amount}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {sourceData.extractedData.dates && sourceData.extractedData.dates.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Important Dates</h4>
                  <div className="flex flex-wrap gap-2">
                    {sourceData.extractedData.dates.map((date: string, index: number) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-orange-50 text-orange-700">
                        📅 {date}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {sourceData.extractedData.links && sourceData.extractedData.links.length > 0 && (
                <div className="col-span-2">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Links</h4>
                  <div className="space-y-1">
                    {sourceData.extractedData.links.map((link: string, index: number) => (
                      <a key={index} href={link} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary-600 hover:text-primary-700 truncate">
                        🔗 {link}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Follow-up Actions */}
        {sourceData?.followUpActions && sourceData.followUpActions.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">🔄 Follow-up Actions</h2>
            <ul className="space-y-2">
              {sourceData.followUpActions.map((action: string, index: number) => (
                <li key={index} className="flex items-start">
                  <span className="text-primary-600 mr-2">•</span>
                  <span className="text-gray-900">{action}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI Reasoning */}
        {item.ai_suggestion_reasoning && (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-medium text-gray-700 mb-2">🤖 AI Analysis</h2>
            <p className="text-sm text-gray-600">{item.ai_suggestion_reasoning}</p>
            <div className="mt-3 flex items-center space-x-4 text-xs text-gray-500">
              <span>Confidence: {item.confidence_score}%</span>
              <span>Priority: {item.priority}/100</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <InboxActions itemId={item.id} status={item.status} />
      </main>
    </div>
  );
}
