import asyncio
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

load_dotenv()

from models import BotRecord, BotState, bots
from scheduler import schedule_bot, scheduler
from transcription_worker import run_transcription, requeue_stuck_transcriptions
from email_backfill_worker import run_email_backfill

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_SECRET = os.getenv('BOT_SECRET', '')
MAX_CONCURRENT_BOTS = int(os.getenv('MAX_CONCURRENT_BOTS', '4'))

app = FastAPI(title='AUGMTD Meeting Bot Service')
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
    scheduler.start()
    logger.info('[Main] APScheduler started')
    os.makedirs('/tmp/recordings', exist_ok=True)
    asyncio.create_task(_stuck_transcription_loop())


@app.on_event('shutdown')
async def shutdown():
    scheduler.shutdown(wait=False)


# --- Request / Response models ---

class JoinRequest(BaseModel):
    meetingUrl: str
    joinAt: str          # ISO 8601
    botName: str = 'AUGMTD Assistant'
    calendarEventId: str
    userId: str
    googleAccessToken: str | None = None  # user's OAuth token for browser auth


class BotStatusResponse(BaseModel):
    botId: str
    state: str
    audioStoragePath: str | None = None


# --- Routes ---

@app.post('/join', response_model=BotStatusResponse)
async def join(body: JoinRequest, _: HTTPAuthorizationCredentials = Depends(verify_auth)):
    # Capacity check
    active = sum(
        1 for b in bots.values()
        if b.state in (BotState.JOINING, BotState.RECORDING, BotState.UPLOADING)
    )
    if active >= MAX_CONCURRENT_BOTS:
        raise HTTPException(status_code=503, detail=f'At capacity ({MAX_CONCURRENT_BOTS} bots active)')

    bot_id = str(uuid4())

    # Parse joinAt — fire immediately if in the past
    try:
        run_at = datetime.fromisoformat(body.joinAt.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=422, detail='joinAt must be ISO 8601')

    now = datetime.now(tz=timezone.utc)
    if run_at < now:
        run_at = now

    bot = BotRecord(
        bot_id=bot_id,
        meeting_url=body.meetingUrl,
        join_at=body.joinAt,
        calendar_event_id=body.calendarEventId,
        user_id=body.userId,
        bot_name=body.botName,
        google_access_token=body.googleAccessToken,
    )
    bots[bot_id] = bot

    schedule_bot(bot_id, run_at)

    logger.info(f'[Main] Created bot {bot_id} for {body.meetingUrl} at {run_at}')
    return BotStatusResponse(botId=bot_id, state=bot.state.value)


@app.get('/bots/{bot_id}', response_model=BotStatusResponse)
async def get_bot(bot_id: str, _: HTTPAuthorizationCredentials = Depends(verify_auth)):
    bot = bots.get(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail='Bot not found')
    return BotStatusResponse(
        botId=bot.bot_id,
        state=bot.state.value,
        audioStoragePath=bot.audio_storage_path,
    )


class TranscribeRequest(BaseModel):
    storagePath: str
    transcriptId: str | None = None   # omit for new bot recordings; provide for retries
    calendarEventId: str | None = None
    userId: str
    source: str = 'bot'


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
    active = sum(
        1 for b in bots.values()
        if b.state in (BotState.JOINING, BotState.RECORDING, BotState.UPLOADING)
    )
    return {'status': 'ok', 'activeBots': active, 'maxBots': MAX_CONCURRENT_BOTS}
