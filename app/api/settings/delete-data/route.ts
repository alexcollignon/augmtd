import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServerClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectionId } = await request.json();

  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  }

  // Verify ownership of specific connection
  if (connectionId !== 'all') {
    const { data: conn } = await supabase
      .from('connections')
      .select('id')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .single();

    if (!conn) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }
  }

  const adminSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const userId = user.id;
  const isAll = connectionId === 'all';

  try {
    // 1. Delete attachment files from storage
    await deleteAttachmentFiles(adminSupabase, userId, isAll ? null : connectionId);

    // 2. Delete work threads (+ their artifact files). On full wipe: all threads.
    //    On connection wipe: only auto-generated threads linked to that connection's inbox items.
    //    Messages cascade automatically via FK.
    await deleteWorkThreads(adminSupabase, userId, isAll ? null : connectionId);

    // 3. Delete inbox_items (email + meeting sourced)
    if (isAll) {
      await adminSupabase.from('inbox_items').delete().eq('user_id', userId);
    } else {
      await adminSupabase
        .from('inbox_items')
        .delete()
        .eq('user_id', userId)
        .eq('connection_id', connectionId);
      // Also delete meeting inbox_items (no connection_id) linked to this connection's transcripts
      await adminSupabase
        .from('inbox_items')
        .delete()
        .eq('user_id', userId)
        .eq('source', 'meeting');
    }

    // 5. Find calendar event IDs for this scope (needed for transcript deletion)
    let calendarEventIds: string[] = [];
    if (isAll) {
      const { data } = await adminSupabase
        .from('calendar_events')
        .select('id')
        .eq('user_id', userId);
      calendarEventIds = (data || []).map(e => e.id);
    } else {
      const { data } = await adminSupabase
        .from('calendar_events')
        .select('id')
        .eq('user_id', userId)
        .eq('connection_id', connectionId);
      calendarEventIds = (data || []).map(e => e.id);
    }

    // 6. Delete meeting transcripts, linked inbox_items, and recordings from storage
    {
      // Fetch all transcripts in scope: calendar-linked + ad-hoc (calendar_event_id IS NULL, isAll only)
      let transcriptQuery = adminSupabase
        .from('meeting_transcripts')
        .select('id, recording_storage_path')
        .eq('user_id', userId);

      if (isAll) {
        // all transcripts for this user (calendar-linked + ad-hoc)
      } else if (calendarEventIds.length > 0) {
        transcriptQuery = transcriptQuery.in('calendar_event_id', calendarEventIds);
      } else {
        transcriptQuery = transcriptQuery.in('id', []); // no-op
      }

      const { data: transcripts } = await transcriptQuery;
      const transcriptIds = (transcripts || []).map(t => t.id);

      if (transcriptIds.length > 0) {
        // Delete linked inbox_items (meeting source)
        await adminSupabase
          .from('inbox_items')
          .delete()
          .eq('user_id', userId)
          .in('source_meeting_transcript_id', transcriptIds);

        // Delete recording files from storage
        const storagePaths = (transcripts || [])
          .map(t => t.recording_storage_path)
          .filter(Boolean) as string[];
        if (storagePaths.length > 0) {
          await adminSupabase.storage.from('meeting-recordings').remove(storagePaths);
        }

        // Delete the transcript rows
        await adminSupabase
          .from('meeting_transcripts')
          .delete()
          .eq('user_id', userId)
          .in('id', transcriptIds);
      }
    }

    // 7. Delete calendar_events
    if (isAll) {
      await adminSupabase.from('calendar_events').delete().eq('user_id', userId);
    } else {
      await adminSupabase
        .from('calendar_events')
        .delete()
        .eq('user_id', userId)
        .eq('connection_id', connectionId);
    }

    // 8. Delete emails
    if (isAll) {
      await adminSupabase.from('emails').delete().eq('user_id', userId);
    } else {
      await adminSupabase
        .from('emails')
        .delete()
        .eq('user_id', userId)
        .eq('connection_id', connectionId);
    }

    // 9. Reset last_sync so next sync re-fetches the full window instead of fetching nothing
    if (isAll) {
      await adminSupabase
        .from('connections')
        .update({ last_sync: null })
        .eq('user_id', userId);
    } else {
      await adminSupabase
        .from('connections')
        .update({ last_sync: null })
        .eq('user_id', userId)
        .eq('id', connectionId);
    }

    // 11. Delete knowledge base data (user-scoped, not connection-scoped — only on full wipe)
    if (isAll) {
      await adminSupabase.from('knowledge_chunks').delete().eq('user_id', userId);
      await adminSupabase.from('knowledge_files').delete().eq('user_id', userId);
      await adminSupabase.from('knowledge_sources').delete().eq('user_id', userId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Delete Data] Error:', error);
    return NextResponse.json({ error: 'Failed to delete data' }, { status: 500 });
  }
}

async function deleteWorkThreads(
  adminSupabase: ReturnType<typeof createServerClient<any, any, any>>,
  userId: string,
  connectionId: string | null
) {
  let threadIds: string[] = [];

  if (connectionId === null) {
    // Full wipe: delete ALL work threads for this user (auto-generated + manual Studio threads)
    const { data } = await adminSupabase
      .from('work_threads')
      .select('id, artifact, artifacts')
      .eq('user_id', userId);
    threadIds = (data || []).map((t: { id: string }) => t.id);

    // Collect all storage paths from artifacts array + legacy singular artifact
    const allPaths = new Set<string>();
    for (const t of (data || [])) {
      const arr = (t as any).artifacts as Array<{ storage_path?: string }> | null;
      if (arr) { for (const a of arr) { if (a.storage_path) allPaths.add(a.storage_path); } }
      const legacy = (t as any).artifact?.storage_path;
      if (legacy) allPaths.add(legacy);
    }
    if (allPaths.size > 0) {
      await adminSupabase.storage.from('work-artifacts').remove([...allPaths]);
    }
  } else {
    // Connection-specific: find inbox items for this connection that link to auto-generated threads
    const { data: items } = await adminSupabase
      .from('inbox_items')
      .select('work_thread_id')
      .eq('user_id', userId)
      .eq('connection_id', connectionId)
      .not('work_thread_id', 'is', null);

    const linkedThreadIds = (items || [])
      .map((i: { work_thread_id: string }) => i.work_thread_id)
      .filter(Boolean);

    if (linkedThreadIds.length > 0) {
      const { data } = await adminSupabase
        .from('work_threads')
        .select('id, artifact, artifacts')
        .eq('user_id', userId)
        .eq('auto_generated', true)
        .in('id', linkedThreadIds);

      threadIds = (data || []).map((t: { id: string }) => t.id);

      const allPaths = new Set<string>();
      const allArtifactIds = new Set<string>();
      for (const t of (data || [])) {
        const arr = (t as any).artifacts as Array<{ id?: string; storage_path?: string }> | null;
        if (arr) {
          for (const a of arr) {
            if (a.storage_path) allPaths.add(a.storage_path);
            if (a.id) allArtifactIds.add(a.id);
          }
        }
        const legacy = (t as any).artifact as { id?: string; storage_path?: string } | null;
        if (legacy?.storage_path) allPaths.add(legacy.storage_path);
        if (legacy?.id) allArtifactIds.add(legacy.id);
      }
      if (allPaths.size > 0) {
        await adminSupabase.storage.from('work-artifacts').remove([...allPaths]);
      }

      // Clean up KB entries for artifacts in these threads
      const kbFileIdSet = new Set<string>();
      if (allArtifactIds.size > 0) {
        const { data: kbByArtifact } = await adminSupabase
          .from('knowledge_files')
          .select('id')
          .in('provider_file_id', [...allArtifactIds])
          .eq('user_id', userId);
        kbByArtifact?.forEach((f: { id: string }) => kbFileIdSet.add(f.id));
      }
      if (allPaths.size > 0) {
        const { data: kbByPath } = await adminSupabase
          .from('knowledge_files')
          .select('id')
          .in('storage_path', [...allPaths])
          .eq('user_id', userId);
        kbByPath?.forEach((f: { id: string }) => kbFileIdSet.add(f.id));
      }
      if (kbFileIdSet.size > 0) {
        const kbFileIds = [...kbFileIdSet];
        await adminSupabase.from('knowledge_chunks').delete().in('file_id', kbFileIds);
        await adminSupabase.from('knowledge_files').delete().in('id', kbFileIds);
      }
    }
  }

  if (threadIds.length > 0) {
    await adminSupabase
      .from('work_threads')
      .delete()
      .eq('user_id', userId)
      .in('id', threadIds);
  }
}

async function deleteAttachmentFiles(
  adminSupabase: ReturnType<typeof createServerClient<any, any, any>>,
  userId: string,
  connectionId: string | null
) {
  let emailIds: string[] = [];

  if (connectionId === null) {
    // All accounts: list every folder under userId/
    const { data: folders } = await adminSupabase.storage
      .from('email-attachments')
      .list(userId);

    emailIds = (folders || []).map((f: { name: string }) => f.name);
  } else {
    // Specific connection: get email IDs for that connection
    const { data: emails } = await adminSupabase
      .from('emails')
      .select('id')
      .eq('user_id', userId)
      .eq('connection_id', connectionId);

    emailIds = (emails || []).map((e: { id: string }) => e.id);
  }

  if (emailIds.length === 0) return;

  const allPaths: string[] = [];

  for (const emailId of emailIds) {
    const { data: files } = await adminSupabase.storage
      .from('email-attachments')
      .list(`${userId}/${emailId}`);

    if (files && files.length > 0) {
      allPaths.push(...files.map((f: { name: string }) => `${userId}/${emailId}/${f.name}`));
    }
  }

  if (allPaths.length > 0) {
    await adminSupabase.storage.from('email-attachments').remove(allPaths);
  }
}
