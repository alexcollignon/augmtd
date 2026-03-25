import asyncio
import json
import logging
import os
import re
import tempfile
import time
from uuid import uuid4

import httpx
from playwright.async_api import async_playwright

from audio_capture import AudioCapture
from models import BotState, bots
from storage_uploader import upload_to_supabase
from transcription_worker import run_transcription

logger = logging.getLogger(__name__)

AUGMTD_WEBHOOK_BASE_URL = os.getenv('AUGMTD_WEBHOOK_BASE_URL', 'https://app.augmtd.com')
BOT_SECRET = os.getenv('BOT_SECRET', '')
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', '')
PROXY_URL = os.getenv('PROXY_URL', '')
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

DEBUG_SCREENSHOT_DIR = '/tmp/recordings'

# Google Meet selectors (with fallbacks)
GUEST_NAME_SELECTORS = [
    'input[placeholder="Your name"]',
    'input[aria-label="Your name"]',
    'input[data-initial-value]',
    'input[jsname="YPqjbf"]',
]
# Combined multi-selector — resolves as soon as ANY variant appears (no sequential waiting)
GUEST_NAME_MULTI_SELECTOR = ', '.join(GUEST_NAME_SELECTORS)
# "Continue without signing in" — shown before the name/join screen
CONTINUE_WITHOUT_SIGNIN_SELECTORS = [
    'button:has-text("Continue without signing in")',
    'a:has-text("Continue without signing in")',
    'button:has-text("Use without an account")',
]
JOIN_BUTTON_SELECTORS = [
    'button[jsname="Qx7uuf"]',   # "Ask to join" jsname (stable across locales)
    'button[jsname="V67aGc"]',   # "Join now" jsname
    'button:has-text("Join now")',  # English text fallback (get_by_role regex covers the rest)
]
IN_CALL_SELECTORS = [
    'div[data-participant-id]',
    '[data-ssrc]',
    '[aria-label*="participant"]',
    '[jsname="r4nke"]',
]
MEETING_ENDED_SELECTORS = [
    '[data-call-ended]',
    'h1:has-text("You\'ve left the call")',
    'h1:has-text("Saiu da reunião")',
    'h1:has-text("Has salido de la videollamada")',
    'h1:has-text("Vous avez quitté")',
    'h1:has-text("Sie haben das Meeting verlassen")',
]


async def _authenticate_with_oauth(page, access_token: str) -> bool:
    """
    Sign the Playwright browser into Google using a valid OAuth access token.
    Uses the accounts.google.com/OAuthLogin endpoint — designed for apps/devices,
    not IP-restricted like password login, so no phone verification triggered.
    """
    if not GOOGLE_CLIENT_ID:
        logger.warning('[BotRunner] GOOGLE_CLIENT_ID not set — skipping OAuth browser auth')
        return False
    try:
        login_url = (
            'https://accounts.google.com/OAuthLogin'
            f'?source=ChromiumBrowser&issuedTo={GOOGLE_CLIENT_ID}&token={access_token}'
        )
        await page.goto(login_url, wait_until='networkidle', timeout=30_000)
        await asyncio.sleep(2)
        current_url = page.url
        logger.info(f'[BotRunner] OAuthLogin URL after navigation: {current_url}')
        # Success if we're past the accounts sign-in page
        if 'accounts.google.com/signin' not in current_url and 'accounts.google.com/ServiceLogin' not in current_url:
            logger.info('[BotRunner] Google OAuth browser auth succeeded')
            return True
        logger.warning('[BotRunner] OAuthLogin redirected to sign-in — token may lack required scopes')
        return False
    except Exception as exc:
        logger.warning(f'[BotRunner] OAuthLogin failed: {exc}')
        return False


async def _patch_transcript(transcript_id: str, fields: dict) -> None:
    """Fire-and-forget PATCH on meeting_transcripts — non-fatal on failure."""
    if not transcript_id or not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return
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
                json=fields,
            )
    except Exception as exc:
        logger.warning(f'[BotRunner] _patch_transcript failed: {exc}')


async def _send_webhook(calendar_event_id: str, bot_id: str, state: str, audio_storage_path: str | None = None) -> None:
    url = f'{AUGMTD_WEBHOOK_BASE_URL}/api/meetings/{calendar_event_id}/bot-webhook'
    payload = {'botId': bot_id, 'state': state}
    if audio_storage_path:
        payload['audioStoragePath'] = audio_storage_path

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={'Authorization': f'Bearer {BOT_SECRET}', 'Content-Type': 'application/json'},
            )
        logger.info(f'[BotRunner] Webhook → {url} ({resp.status_code})')
    except Exception as exc:
        logger.error(f'[BotRunner] Webhook failed for bot {bot_id}: {exc}')


async def _poll_captions(page, caption_log: list, stop_event: asyncio.Event) -> None:
    """
    Poll Google Meet's live captions DOM every 2s and append speaker-attributed
    entries to caption_log in-place. Always non-fatal — any exception is silently swallowed.

    Google Meet caption structure (stable jsname="tgaKEf"):
      Each caption block is a <div> child with:
        spans[0] = speaker display name
        spans[1] = caption text
    Also tries .a4cQT (obfuscated but common class) as a fallback container.
    """
    while not stop_event.is_set():
        try:
            entries = await page.evaluate("""
                (() => {
                    const results = [];
                    const candidates = document.querySelectorAll(
                        '[jsname="tgaKEf"] > div, .a4cQT > div'
                    );
                    candidates.forEach(el => {
                        const spans = el.querySelectorAll('span');
                        if (spans.length >= 2) {
                            const speaker = spans[0].textContent.trim();
                            const text = spans[1].textContent.trim();
                            if (text) results.push({ speaker: speaker || 'Speaker', text });
                        }
                    });
                    return results;
                })()
            """)
            now = int(time.time())
            for entry in entries:
                # Deduplicate: skip if identical to any of the last 3 captured entries
                dup = any(
                    c['speaker'] == entry['speaker'] and c['text'] == entry['text']
                    for c in caption_log[-3:]
                )
                if not dup:
                    caption_log.append({'speaker': entry['speaker'], 'text': entry['text'], 'timestamp': now})
        except Exception:
            pass  # page may be mid-navigation or already closed — always non-fatal
        await asyncio.sleep(2)


async def run_bot(bot_id: str) -> None:
    bot = bots.get(bot_id)
    if not bot:
        logger.error(f'[BotRunner] Bot {bot_id} not found in registry')
        return

    local_path = os.path.join('/tmp/recordings', f'{bot_id}.webm')
    capture = AudioCapture(bot_id, local_path)
    caption_file: str | None = None  # set inside browser block if captions are captured

    # For ad-hoc bots: pre-insert transcript row so the UI can track live state.
    # Scheduled bots use calendar_events.attendee_bot_state for live tracking instead.
    adhoc_transcript_id: str | None = None

    try:
        # --- JOINING ---
        bot.state = BotState.JOINING
        logger.info(f'[BotRunner] Bot {bot_id} joining: {bot.meeting_url}')

        if bot.calendar_event_id:
            await _send_webhook(bot.calendar_event_id, bot_id, 'joining')

        if not bot.calendar_event_id and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
            from datetime import datetime, timezone
            adhoc_transcript_id = str(uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()
            try:
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
                            'id': adhoc_transcript_id,
                            'user_id': bot.user_id,
                            'meeting_id': adhoc_transcript_id,
                            'calendar_event_id': None,
                            'title': 'Ad-hoc meeting',
                            'start_time': now_iso,
                            'end_time': now_iso,
                            'duration_minutes': 0,
                            'source': 'bot',
                            'transcript': '',
                            'transcript_segments': [],
                            'attendees': [],
                            'processed': False,
                            'bot_state': 'joining',
                        },
                    )
                    ins_resp.raise_for_status()
                logger.info(f'[BotRunner] Pre-inserted ad-hoc transcript row {adhoc_transcript_id}')
            except Exception as ins_err:
                logger.warning(f'[BotRunner] Ad-hoc pre-insert failed: {ins_err}')
                adhoc_transcript_id = None

        await capture.create_sink()

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--use-fake-ui-for-media-stream',
                    '--autoplay-policy=no-user-gesture-required',
                ],
                env={
                    **os.environ,
                    'PULSE_SINK': capture.get_pulse_sink(),
                    'DISPLAY': os.getenv('DISPLAY', ':99'),
                    'HOME': '/root',
                    'XDG_RUNTIME_DIR': '/run/user/0',
                },
            )

            # Load saved Google auth cookies if available
            auth_file = '/app/google-auth.json'
            storage_state = auth_file if os.path.exists(auth_file) else None
            if storage_state:
                logger.info(f'[BotRunner] Loading Google auth from {auth_file}')
            else:
                logger.warning('[BotRunner] No google-auth.json found — joining as anonymous guest')

            proxy = {'server': PROXY_URL} if PROXY_URL else None
            if proxy:
                logger.info(f'[BotRunner] Using residential proxy')
            else:
                logger.warning('[BotRunner] No PROXY_URL set — datacenter IP may be blocked by Google')

            try:
                from playwright_stealth import stealth_async  # type: ignore
                context = await browser.new_context(storage_state=storage_state, proxy=proxy)
                page = await context.new_page()
                await stealth_async(page)
            except ImportError:
                logger.warning('[BotRunner] playwright-stealth not available, proceeding without it')
                context = await browser.new_context(storage_state=storage_state, proxy=proxy)
                page = await context.new_page()

            # Authenticate the browser as the user via OAuth before joining Meet
            if bot.google_access_token:
                authed = await _authenticate_with_oauth(page, bot.google_access_token)
                if not authed:
                    logger.warning('[BotRunner] OAuth auth failed — will try joining as guest')
            else:
                logger.warning('[BotRunner] No googleAccessToken — joining as anonymous guest')

            await page.goto(bot.meeting_url, wait_until='domcontentloaded', timeout=60_000)
            await asyncio.sleep(2)

            # Debug screenshot — see what the page looks like
            screenshot_path = f'{DEBUG_SCREENSHOT_DIR}/{bot_id}_01_loaded.png'
            await page.screenshot(path=screenshot_path)
            logger.info(f'[BotRunner] Screenshot saved: {screenshot_path}')

            # Handle "Continue without signing in" if present
            for selector in CONTINUE_WITHOUT_SIGNIN_SELECTORS:
                try:
                    btn = await page.wait_for_selector(selector, timeout=2_000)
                    if btn:
                        await btn.click()
                        logger.info(f'[BotRunner] Clicked continue without signing in')
                        await asyncio.sleep(2)
                        break
                except Exception:
                    continue

            # Fill guest name — try all selector variants in parallel (resolves on first match)
            name_input = None
            try:
                name_input = await page.wait_for_selector(GUEST_NAME_MULTI_SELECTOR, timeout=10_000)
            except Exception:
                pass

            if name_input:
                await name_input.fill(bot.bot_name)
                await page.keyboard.press('Tab')
                await asyncio.sleep(1)

            # Debug screenshot — after filling name
            screenshot_path2 = f'{DEBUG_SCREENSHOT_DIR}/{bot_id}_02_name_filled.png'
            await page.screenshot(path=screenshot_path2)
            logger.info(f'[BotRunner] Screenshot saved: {screenshot_path2}')

            # Dismiss any device warning popups (microphone/camera not found dialogs)
            try:
                await page.keyboard.press('Escape')
                await asyncio.sleep(0.5)
                # Also try clicking the close (×) button on any open dialog
                close_btn = await page.query_selector('button[aria-label="Close"], button[aria-label="Fechar"], button[jsname="LgbsSe"]')
                if close_btn:
                    await close_btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                pass

            # Diagnostic: log all buttons visible on the page
            try:
                all_btns = await page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button'))
                        .map(b => b.innerText.trim())
                        .filter(t => t.length > 0);
                }""")
                logger.info(f'[BotRunner] Buttons found on page: {all_btns}')
                # Also check iframes
                frames = page.frames
                for f in frames:
                    try:
                        fb = await f.evaluate("""() => {
                            return Array.from(document.querySelectorAll('button'))
                                .map(b => b.innerText.trim()).filter(t => t.length > 0);
                        }""")
                        if fb:
                            logger.info(f'[BotRunner] Buttons in frame {f.name or f.url[:60]}: {fb}')
                    except Exception:
                        pass
            except Exception as e:
                logger.warning(f'[BotRunner] Button diagnostic failed: {e}')

            # Click join button — use get_by_role which pierces Shadow DOM
            joined = False
            join_pattern = re.compile(
                r'join|ask|request|pedir|participar|demander|participer|'
                r'unirse|teilnehmen|rejoindre|entrar',
                re.IGNORECASE
            )
            try:
                btn = page.get_by_role('button', name=join_pattern)
                await btn.first.click(timeout=10_000, force=True)
                joined = True
                logger.info('[BotRunner] Clicked join button via get_by_role')
            except Exception as e:
                logger.warning(f'[BotRunner] get_by_role join failed: {e}')

            # Fallback: CSS/text selectors
            if not joined:
                for selector in JOIN_BUTTON_SELECTORS:
                    try:
                        btn = await page.wait_for_selector(selector, timeout=3_000)
                        if btn:
                            await btn.click(force=True)
                            joined = True
                            logger.info(f'[BotRunner] Clicked join button via selector: {selector}')
                            break
                    except Exception:
                        continue

            # Final fallback: JS click on any visible join/ask button
            if not joined:
                try:
                    clicked = await page.evaluate("""() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const patterns = /pedir|participar|join|ask|request|unirse|teilnehmen/i;
                        const btn = buttons.find(b => patterns.test(b.innerText));
                        if (btn) { btn.click(); return true; }
                        return false;
                    }""")
                    if clicked:
                        joined = True
                        logger.info('[BotRunner] Clicked join button via JS fallback')
                except Exception as e:
                    logger.warning(f'[BotRunner] JS click fallback failed: {e}')

            # Debug screenshot — after join attempt
            screenshot_path3 = f'{DEBUG_SCREENSHOT_DIR}/{bot_id}_03_after_join.png'
            await page.screenshot(path=screenshot_path3)
            logger.info(f'[BotRunner] Screenshot saved: {screenshot_path3}')

            if not joined:
                raise RuntimeError('Could not find join/ask-to-join button')

            # Wait for in-call indicator (up to 5 min)
            in_call = False
            for selector in IN_CALL_SELECTORS:
                try:
                    await page.wait_for_selector(selector, timeout=300_000)
                    in_call = True
                    break
                except Exception:
                    continue

            if not in_call:
                raise RuntimeError('Timed out waiting to be admitted to the call')

            # --- RECORDING ---
            bot.state = BotState.RECORDING
            await capture.start_recording()
            logger.info(f'[BotRunner] Bot {bot_id} is now recording')
            if bot.calendar_event_id:
                await _send_webhook(bot.calendar_event_id, bot_id, 'recording')
            if adhoc_transcript_id:
                await _patch_transcript(adhoc_transcript_id, {'bot_state': 'recording'})

            # Enable Google Meet live captions for speaker identification
            try:
                await page.keyboard.press('c')  # Meet caption toggle shortcut
                await asyncio.sleep(1)
                logger.info('[BotRunner] Sent caption toggle keystroke')
            except Exception as cap_key_exc:
                logger.warning(f'[BotRunner] Caption keystroke failed: {cap_key_exc}')
            try:
                cc_btn = await page.query_selector(
                    'button[aria-label="Turn on captions"], '
                    'button[aria-label="Enable captions"], '
                    'button[aria-label="Ativar legendas"], '
                    'button[aria-label="Activer les sous-titres"]'
                )
                if cc_btn:
                    await cc_btn.click(force=True)
                    await asyncio.sleep(1)
                    logger.info('[BotRunner] Clicked CC button to enable captions')
            except Exception as cc_exc:
                logger.warning(f'[BotRunner] CC button click failed: {cc_exc}')

            # Start caption polling task (runs alongside recording loop)
            caption_log: list = []
            caption_stop = asyncio.Event()
            caption_task = asyncio.create_task(_poll_captions(page, caption_log, caption_stop))
            logger.info('[BotRunner] Caption polling task started')

            # Poll every 5s for meeting-ended selectors (hard cap 4 hours)
            hard_timeout = 4 * 60 * 60  # seconds
            elapsed = 0
            poll_interval = 5
            meeting_ended = False
            alone_since = None  # track when bot became the only participant

            while elapsed < hard_timeout:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

                for selector in MEETING_ENDED_SELECTORS:
                    try:
                        el = await page.query_selector(selector)
                        if el:
                            meeting_ended = True
                            break
                    except Exception:
                        pass

                if meeting_ended:
                    logger.info(f'[BotRunner] Bot {bot_id} detected meeting ended after {elapsed}s')
                    break

                # Detect "bot is alone" — if participant count stays at 1 for 2 min, leave
                try:
                    participant_count = await page.evaluate("""() => {
                        return document.querySelectorAll('[data-participant-id]').length;
                    }""")
                    if participant_count <= 1:
                        if alone_since is None:
                            alone_since = elapsed
                            logger.info(f'[BotRunner] Bot {bot_id} appears to be alone in meeting')
                        elif elapsed - alone_since >= 30:
                            logger.info(f'[BotRunner] Bot {bot_id} alone for 2min — ending recording')
                            meeting_ended = True
                            break
                    else:
                        alone_since = None
                except Exception:
                    pass

            if not meeting_ended:
                logger.warning(f'[BotRunner] Bot {bot_id} hit 4-hour hard cap — leaving meeting')

            # Stop caption polling and persist results
            caption_stop.set()
            try:
                await asyncio.wait_for(caption_task, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            logger.info(f'[BotRunner] Captured {len(caption_log)} caption entries')

            if caption_log:
                _caption_file = f'/tmp/captions_{bot_id}.json'
                try:
                    with open(_caption_file, 'w') as f:
                        json.dump(caption_log, f)
                    caption_file = _caption_file
                    logger.info(f'[BotRunner] Caption log written → {caption_file}')
                except Exception as cf_exc:
                    logger.warning(f'[BotRunner] Caption file write failed: {cf_exc}')

            await browser.close()

        # --- UPLOADING ---
        bot.state = BotState.UPLOADING
        logger.info(f'[BotRunner] Bot {bot_id} stopping audio capture')

        await capture.stop()

        # Use calendarEventId as filename; fall back to a UUID for ad-hoc bots
        file_id = bot.calendar_event_id or str(uuid4())
        storage_path = f'{bot.user_id}/{file_id}.webm'
        logger.info(f'[BotRunner] Uploading {local_path} → {storage_path}')
        await upload_to_supabase(local_path, storage_path)

        bot.audio_storage_path = storage_path
        bot.state = BotState.ENDED

        # Notify Vercel of state change — only for calendar-linked bots
        if bot.calendar_event_id:
            await _send_webhook(bot.calendar_event_id, bot_id, 'ended')

        # For ad-hoc bots: update the pre-inserted row with the final storage path.
        if adhoc_transcript_id:
            await _patch_transcript(adhoc_transcript_id, {'recording_storage_path': storage_path})

        # Transcribe locally — avoids Vercel 300s function timeout for large audio files.
        # run_transcription pre-inserts the pending row (or updates existing for ad-hoc),
        # calls local Whisper, writes segments to Supabase, then calls Vercel /generate-insights.
        asyncio.create_task(run_transcription(
            storage_path=storage_path,
            calendar_event_id=bot.calendar_event_id or None,
            user_id=bot.user_id,
            source='bot',
            transcript_id=adhoc_transcript_id,
            caption_file=caption_file,
        ))

        # Clean up local files
        try:
            os.unlink(local_path)
        except OSError:
            pass
        if caption_file:
            try:
                os.unlink(caption_file)
            except OSError:
                pass

        logger.info(f'[BotRunner] Bot {bot_id} completed successfully')

    except Exception as exc:
        logger.exception(f'[BotRunner] Bot {bot_id} failed: {exc}')
        try:
            await capture.stop()
        except Exception:
            pass

        bot.state = BotState.FAILED
        bot.error = str(exc)

        await _send_webhook(bot.calendar_event_id, bot_id, 'failed')
