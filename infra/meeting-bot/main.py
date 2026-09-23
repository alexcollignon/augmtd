# The Hetzner transcription service for IN-PERSON recordings (+ the email-backfill lane).
# The auto-join Google Meet bot (Playwright/PulseAudio: /join, /bots/{id}, the APScheduler job
# store) was REMOVED Sep 23 — owner: "we're only using the in-person recording action".
import asyncio
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

load_dotenv()

from transcription_worker import run_transcription, requeue_stuck_transcriptions
from email_backfill_worker import run_email_backfill

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_SECRET = os.getenv('BOT_SECRET', '')

app = FastAPI(title='AUGMTD Transcription Service')
security = HTTPBearer()


def verify_auth(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not BOT_SECRET:
        raise HTTPException(status_code=500, detail='BOT_SECRET not configured')
    if credentials.credentials != BOT_SECRET:
        raise HTTPException(status_code=401, detail='Invalid credentials')
    return credentials


async def _stuck_transcription_loop():
    """A crashed/rebooted worker must never leave a recording stuck at 'processing' —
    scan shortly after startup (the reboot case), then every 30 min (the crash case).
    Sequential by construction: one loop, awaited requeues — no double-processing."""
    await asyncio.sleep(120)  # let a fresh deploy settle before touching anything
    while True:
        try:
            await requeue_stuck_transcriptions()
        except Exception as exc:
            logger.error(f'[Main] stuck-transcription sweep error: {exc}')
        await asyncio.sleep(30 * 60)


@app.on_event('startup')
async def startup():
    os.makedirs('/tmp/recordings', exist_ok=True)
    asyncio.create_task(_stuck_transcription_loop())


# --- Routes ---

class TranscribeRequest(BaseModel):
    storagePath: str
    transcriptId: str | None = None   # every live caller sends it (the row is pre-inserted)
    calendarEventId: str | None = None
    userId: str
    source: str = 'recording'


@app.post('/transcribe', status_code=202)
async def transcribe(body: TranscribeRequest, _: HTTPAuthorizationCredentials = Depends(verify_auth)):
    asyncio.create_task(run_transcription(
        storage_path=body.storagePath,
        calendar_event_id=body.calendarEventId,
        user_id=body.userId,
        source=body.source,
        transcript_id=body.transcriptId,
    ))
    logger.info(f'[Main] Queued transcription for storage_path={body.storagePath} transcript_id={body.transcriptId}')
    return {'status': 'queued', 'transcriptId': body.transcriptId}


class BackfillRequest(BaseModel):
    connectionId: str
    userId: str
    maxEmails: int = 100
    appUrl: str


@app.post('/email-backfill', status_code=202)
async def email_backfill(body: BackfillRequest, _: HTTPAuthorizationCredentials = Depends(verify_auth)):
    asyncio.create_task(run_email_backfill(
        connection_id=body.connectionId,
        user_id=body.userId,
        max_emails=body.maxEmails,
        app_url=body.appUrl,
    ))
    logger.info(f'[Main] Queued email backfill for connection={body.connectionId} max={body.maxEmails}')
    return {'status': 'queued'}


@app.get('/health')
async def health():
    return {'status': 'ok'}
