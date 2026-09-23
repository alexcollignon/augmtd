"""
Transcription worker — runs entirely on Hetzner, no Vercel timeout risk.

Flow:
  1. Download audio from Supabase Storage
  2. Call local Whisper (http://localhost:8000) — fast, no network hop
  3. Update the caller's pre-inserted meeting_transcripts row with segments
  4. Call Vercel /api/meetings/recording/{transcriptId}/generate-insights
     (fast AI call, < 30s — no Whisper involved)
"""

import logging
import os
import subprocess
import tempfile

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
    source: str = 'recording',
    transcript_id: str | None = None,  # required in practice — the caller pre-inserts the row
) -> None:
    """
    Background task: transcribe audio and update the caller's pre-inserted meeting_transcripts row.
    """
    logger.info(f'[Transcription] Starting — storage_path={storage_path} transcript_id={transcript_id}')

    try:
        # 1. Times for the duration fallback (the row already carries the real ones)
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        start_time = now_iso
        end_time = now_iso
        # Every live caller (the in-person /confirm route, both retry routes, the stuck-
        # transcription sweep) pre-inserts the meeting_transcripts row and passes its id. The
        # no-id branch (calendar lookup + text-note patch + pre-insert) served ONLY the auto-join
        # bot, removed Sep 23 — a call without an id is refused rather than guessed at.
        if not transcript_id:
            logger.error(f'[Transcription] Refused — no transcript_id for storage_path={storage_path} (the bot-era insert path is retired)')
            return

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
        # Retry on connection-level errors (RemoteProtocolError / ConnectError) which
        # happen on the very first request when faster-whisper-server is loading the
        # model lazily — and when the server was OOM-killed mid-request and docker
        # restarted it (observed live Aug 4-5 under the old float32 config).
        #
        # Model: large-v3-turbo int8 (benchmarked Aug 5 on this box: ~2-3x faster than
        # the old medium/float32 AND more accurate). The server must run with
        # WHISPER__COMPUTE_TYPE=int8 — see infra/hetzner/docker-compose.yml.
        # NB: the server SILENTLY IGNORES unknown form fields (condition_on_previous_text
        # was never applied) — only send fields in its openapi schema.
        # `language` is intentionally OMITTED → Whisper auto-detects per file, so a
        # Portuguese/German meeting is transcribed in its own language instead of being
        # forced through English (the old hardcode).
        # `prompt` seeds punctuated decoding — turbo without it emits lowercase,
        # punctuation-free text (verified on this box).
        import asyncio as _asyncio
        filename = storage_path.split('/')[-1]
        _MAX_WHISPER_RETRIES = 3
        whisper_data = None
        for _attempt in range(1, _MAX_WHISPER_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=3600.0) as client:
                    whisper_resp = await client.post(
                        f'{WHISPER_URL}/v1/audio/transcriptions',
                        files={'file': (filename, audio_bytes, 'audio/webm')},
                        data={
                            'model': 'deepdml/faster-whisper-large-v3-turbo-ct2',
                            'response_format': 'verbose_json',
                            'vad_filter': 'true',
                            'prompt': 'Okay, let us begin.',
                        },
                    )
                    whisper_resp.raise_for_status()
                    whisper_data = whisper_resp.json()
                    break
            except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError) as _e:
                if _attempt == _MAX_WHISPER_RETRIES:
                    raise
                logger.warning(f'[Transcription] Whisper attempt {_attempt} failed ({_e}) — retrying in 5s')
                await _asyncio.sleep(5)
        if whisper_data is None:
            raise RuntimeError('Whisper returned no data after retries')

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
            async with httpx.AsyncClient(timeout=300.0) as client:
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


# ── THE STUCK-TRANSCRIPTION SWEEP (Aug 5) ─────────────────────────────────────────────────────
# run_transcription is a fire-and-forget asyncio task: a worker crash, container recreate, or
# box reboot mid-transcription leaves the row at bot_state='processing' FOREVER — the audio sits
# safely in storage while the UI shows "Transcribing…" indefinitely and nothing ever retries.
# This sweep (startup + every 30 min, wired in main.py) requeues such rows through the existing
# retry path (transcript_id given → update in place, idempotent). Rows are processed
# SEQUENTIALLY so a batch of stragglers can't stampede the 4-core Whisper box, and the loop's
# own await ordering guarantees a still-running requeue is never picked up twice.

_STUCK_THRESHOLD_MIN = 30
_STUCK_BATCH_CAP = 3


async def requeue_stuck_transcriptions() -> None:
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=_STUCK_THRESHOLD_MIN)).isoformat()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f'{SUPABASE_URL}/rest/v1/meeting_transcripts',
                params={
                    'bot_state': 'eq.processing',
                    'recording_storage_path': 'not.is.null',
                    'updated_at': f'lt.{cutoff}',
                    'select': 'id,user_id,recording_storage_path,calendar_event_id,source,updated_at',
                    'order': 'updated_at.asc',
                    'limit': str(_STUCK_BATCH_CAP),
                },
                headers={
                    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                },
            )
            resp.raise_for_status()
            rows = resp.json()
    except Exception as exc:
        logger.warning(f'[StuckSweep] scan failed: {exc}')
        return

    if not rows:
        return
    logger.info(f'[StuckSweep] Requeuing {len(rows)} stuck transcription(s)')
    for row in rows:
        try:
            await run_transcription(
                storage_path=row['recording_storage_path'],
                calendar_event_id=row.get('calendar_event_id'),
                user_id=row['user_id'],
                source=row.get('source') or 'recording',
                transcript_id=row['id'],
            )
        except Exception as exc:
            logger.error(f'[StuckSweep] requeue failed for {row["id"]}: {exc}')
