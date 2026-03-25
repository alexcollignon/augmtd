"""
Transcription worker — runs entirely on Hetzner, no Vercel timeout risk.

Flow:
  1. Download audio from Supabase Storage
  2. Call local Whisper (http://localhost:8000) — fast, no network hop
  3. Pre-insert or update meeting_transcripts row with segments
  4. Call Vercel /api/meetings/recording/{transcriptId}/generate-insights
     (fast AI call, < 30s — no Whisper involved)
"""

import json
import logging
import os
import subprocess
import tempfile
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
WHISPER_URL = os.getenv('WHISPER_SERVICE_URL', 'http://whisper:8000')
AUGMTD_BASE_URL = os.getenv('AUGMTD_WEBHOOK_BASE_URL', '')
BOT_SECRET = os.getenv('BOT_SECRET', '')


async def run_transcription(
    storage_path: str,
    calendar_event_id: str | None,
    user_id: str,
    source: str = 'bot',
    transcript_id: str | None = None,  # None → pre-insert new row
    caption_file: str | None = None,   # path to /tmp/captions_{bot_id}.json, or None
) -> None:
    """
    Background task: transcribe audio and store results.
    If transcript_id is given, updates that row (retry path).
    Otherwise queries calendar_events and inserts a new row.
    """
    logger.info(f'[Transcription] Starting — storage_path={storage_path} transcript_id={transcript_id}')

    try:
        # 1. Resolve title / times (needed for insert; skip for update)
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        title = 'Ad-hoc meeting'
        start_time = now_iso
        end_time = now_iso
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
                        'calendar_event_id': calendar_event_id or None,
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

        # 3b. Remux webm to add duration header (browser/ffmpeg recordings omit it)
        try:
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_in:
                tmp_in.write(audio_bytes)
                tmp_in_path = tmp_in.name
            tmp_out_path = tmp_in_path + '_fixed.webm'
            result = subprocess.run(
                ['ffmpeg', '-y', '-i', tmp_in_path, '-c', 'copy', tmp_out_path],
                capture_output=True, timeout=60,
            )
            if result.returncode == 0:
                with open(tmp_out_path, 'rb') as f:
                    fixed_bytes = f.read()
                # Re-upload fixed file to Supabase Storage
                upload_url = f'{SUPABASE_URL}/storage/v1/object/meeting-recordings/{storage_path}'
                async with httpx.AsyncClient(timeout=60.0) as client:
                    up_resp = await client.put(
                        upload_url,
                        content=fixed_bytes,
                        headers={
                            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                            'apikey': SUPABASE_SERVICE_ROLE_KEY,
                            'Content-Type': 'audio/webm',
                        },
                    )
                if up_resp.status_code < 300:
                    audio_bytes = fixed_bytes
                    logger.info(f'[Transcription] Remuxed + re-uploaded for {transcript_id}')
                else:
                    logger.warning(f'[Transcription] Re-upload failed ({up_resp.status_code}), using original')
            else:
                logger.warning(f'[Transcription] ffmpeg remux failed (rc={result.returncode}), using original')
        except Exception as remux_err:
            logger.warning(f'[Transcription] Remux skipped: {remux_err}')
        finally:
            for p in [tmp_in_path, tmp_out_path]:
                try:
                    os.unlink(p)
                except Exception:
                    pass

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
                    'vad_filter': 'true',           # skip silent segments → prevents hallucination loops
                    'condition_on_previous_text': 'false',  # don't feed prior output back → stops repetition
                },
            )
            whisper_resp.raise_for_status()
            whisper_data = whisper_resp.json()

        raw_segments = whisper_data.get('segments', [])
        normalized = [
            {'speaker': 'Speaker', 'text': s['text'].strip(), 'timestamp': round(s['start'])}
            for s in raw_segments
            if s.get('text', '').strip()
        ]

        # Deduplicate: remove consecutive segments with identical text (Whisper looping artifact)
        deduped = []
        for seg in normalized:
            if deduped and deduped[-1]['text'].lower() == seg['text'].lower():
                continue
            deduped.append(seg)
        normalized = deduped

        full_text = whisper_data.get('text', '')
        if not normalized and full_text.strip():
            normalized = [{'speaker': 'Speaker', 'text': full_text.strip(), 'timestamp': 0}]

        # Load caption log for speaker identification (written by bot_runner during recording)
        caption_log = []
        if caption_file:
            try:
                with open(caption_file, 'r') as f:
                    caption_log = json.load(f)
                logger.info(f'[Transcription] Loaded {len(caption_log)} caption entries from {caption_file}')
            except Exception as cap_load_err:
                logger.warning(f'[Transcription] Could not load caption file: {cap_load_err}')
            finally:
                try:
                    os.unlink(caption_file)
                except Exception:
                    pass

        # Merge caption speaker names into Whisper segments (nearest match within ±30s)
        # Caption timestamps are Unix epoch seconds; Whisper timestamps are seconds from
        # start of audio. Normalise by subtracting the earliest caption timestamp so both
        # use the same relative-seconds scale.
        if len(caption_log) > 3 and normalized:
            logger.info('[Transcription] Merging caption speakers into Whisper segments')
            caption_start = min(c['timestamp'] for c in caption_log)
            for seg in normalized:
                seg_ts = seg['timestamp']  # seconds from audio start
                best: dict | None = None
                best_dist = 999999
                for cap in caption_log:
                    cap_relative = cap['timestamp'] - caption_start  # also seconds from start
                    dist = abs(cap_relative - seg_ts)
                    if dist < best_dist and dist <= 30:
                        best_dist = dist
                        best = cap
                if best:
                    seg['speaker'] = best['speaker']
            distinct = {s['speaker'] for s in normalized}
            logger.info(f'[Transcription] Speaker merge complete — distinct speakers: {distinct}')

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
