"""
Transcription worker — runs entirely on Hetzner, no Vercel timeout risk.

Flow:
  1. Download audio from Supabase Storage
  2. Call local Whisper (http://localhost:8000) — fast, no network hop
  3. Pre-insert or update meeting_transcripts row with segments
  4. Call Vercel /api/meetings/recording/{transcriptId}/generate-insights
     (fast AI call, < 30s — no Whisper involved)
"""

import logging
import os
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
WHISPER_URL = 'http://localhost:8000'  # always local
AUGMTD_BASE_URL = os.getenv('AUGMTD_WEBHOOK_BASE_URL', '')
BOT_SECRET = os.getenv('BOT_SECRET', '')


async def run_transcription(
    storage_path: str,
    calendar_event_id: str | None,
    user_id: str,
    source: str = 'bot',
    transcript_id: str | None = None,  # None → pre-insert new row
) -> None:
    """
    Background task: transcribe audio and store results.
    If transcript_id is given, updates that row (retry path).
    Otherwise queries calendar_events and inserts a new row.
    """
    logger.info(f'[Transcription] Starting — storage_path={storage_path} transcript_id={transcript_id}')

    try:
        # 1. Resolve title / times (needed for insert; skip for update)
        title = 'Meeting'
        start_time = ''
        end_time = ''
        if not transcript_id and calendar_event_id:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f'{SUPABASE_URL}/rest/v1/calendar_events',
                    params={'id': f'eq.{calendar_event_id}', 'select': 'title,start_time,end_time'},
                    headers={
                        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    },
                )
                resp.raise_for_status()
                rows = resp.json()
                if rows:
                    title = rows[0].get('title', 'Meeting')
                    start_time = rows[0].get('start_time', '')
                    end_time = rows[0].get('end_time', '')

        # 2. Pre-insert pending row if this is a new transcription
        if not transcript_id:
            transcript_id = str(uuid4())
            async with httpx.AsyncClient(timeout=15.0) as client:
                ins_resp = await client.post(
                    f'{SUPABASE_URL}/rest/v1/meeting_transcripts',
                    headers={
                        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal',
                    },
                    json={
                        'id': transcript_id,
                        'user_id': user_id,
                        'meeting_id': calendar_event_id or transcript_id,
                        'calendar_event_id': calendar_event_id,
                        'title': title,
                        'start_time': start_time,
                        'end_time': end_time,
                        'duration_minutes': 0,
                        'source': source,
                        'recording_storage_path': storage_path,
                        'transcript': '',
                        'transcript_segments': [],
                        'attendees': [],
                        'processed': False,
                        'bot_state': 'processing',
                    },
                )
                ins_resp.raise_for_status()
            logger.info(f'[Transcription] Pre-inserted transcript row {transcript_id}')

        # 3. Download audio from Supabase Storage
        download_url = f'{SUPABASE_URL}/storage/v1/object/meeting-recordings/{storage_path}'
        async with httpx.AsyncClient(timeout=120.0) as client:
            dl_resp = await client.get(
                download_url,
                headers={
                    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                },
            )
            dl_resp.raise_for_status()
            audio_bytes = dl_resp.content

        logger.info(f'[Transcription] Downloaded {len(audio_bytes):,} bytes for {transcript_id}')

        # 4. Call local Whisper — no timeout risk (localhost)
        filename = storage_path.split('/')[-1]
        async with httpx.AsyncClient(timeout=3600.0) as client:
            whisper_resp = await client.post(
                f'{WHISPER_URL}/v1/audio/transcriptions',
                files={'file': (filename, audio_bytes, 'audio/webm')},
                data={
                    'model': 'Systran/faster-whisper-medium',
                    'response_format': 'verbose_json',
                    'language': 'en',
                },
            )
            whisper_resp.raise_for_status()
            whisper_data = whisper_resp.json()

        raw_segments = whisper_data.get('segments', [])
        normalized = [
            {'speaker': 'Speaker', 'text': s['text'].strip(), 'timestamp': round(s['start'])}
            for s in raw_segments
        ]
        full_text = whisper_data.get('text', '')
        if not normalized and full_text.strip():
            normalized = [{'speaker': 'Speaker', 'text': full_text.strip(), 'timestamp': 0}]

        logger.info(f'[Transcription] {len(normalized)} segments for {transcript_id}')

        # 5. Compute duration
        duration_minutes = 0
        if start_time and end_time:
            try:
                from datetime import datetime
                t0 = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                t1 = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                duration_minutes = max(0, round((t1 - t0).total_seconds() / 60))
            except Exception:
                pass

        transcript_text = '\n'.join(f'[{s["speaker"]}]: {s["text"]}' for s in normalized)

        # 6. Write segments to Supabase
        async with httpx.AsyncClient(timeout=30.0) as client:
            patch_resp = await client.patch(
                f'{SUPABASE_URL}/rest/v1/meeting_transcripts',
                params={'id': f'eq.{transcript_id}'},
                headers={
                    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                },
                json={
                    'transcript': transcript_text,
                    'transcript_segments': normalized,
                    'duration_minutes': duration_minutes,
                    'bot_state': 'processing',  # Vercel will set 'ended' after insights
                },
            )
            patch_resp.raise_for_status()

        logger.info(f'[Transcription] Segments written for {transcript_id}, calling Vercel for insights')

        # 7. Call Vercel generate-insights (fast — no Whisper)
        if AUGMTD_BASE_URL and BOT_SECRET:
            async with httpx.AsyncClient(timeout=120.0) as client:
                ins_resp = await client.post(
                    f'{AUGMTD_BASE_URL}/api/meetings/recording/{transcript_id}/generate-insights',
                    headers={
                        'Authorization': f'Bearer {BOT_SECRET}',
                        'Content-Type': 'application/json',
                    },
                    json={'transcriptId': transcript_id},
                )
                if ins_resp.status_code >= 400:
                    logger.error(
                        f'[Transcription] generate-insights failed: {ins_resp.status_code} {ins_resp.text[:300]}'
                    )
                else:
                    logger.info(f'[Transcription] Done for {transcript_id}')

    except Exception as exc:
        logger.error(f'[Transcription] Failed for {transcript_id}: {exc}')
        if transcript_id:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.patch(
                        f'{SUPABASE_URL}/rest/v1/meeting_transcripts',
                        params={'id': f'eq.{transcript_id}'},
                        headers={
                            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                            'apikey': SUPABASE_SERVICE_ROLE_KEY,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal',
                        },
                        json={'bot_state': 'failed', 'processed': True},
                    )
            except Exception as mark_err:
                logger.error(f'[Transcription] Could not mark as failed: {mark_err}')
