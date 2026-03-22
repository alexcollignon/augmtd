import asyncio
import logging
import os
import re
import tempfile

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

DEBUG_SCREENSHOT_DIR = '/tmp/recordings'

# Google Meet selectors (with fallbacks)
GUEST_NAME_SELECTORS = [
    'input[placeholder="Your name"]',
    'input[aria-label="Your name"]',
    'input[data-initial-value]',
    'input[jsname="YPqjbf"]',
]
# "Continue without signing in" — shown before the name/join screen
CONTINUE_WITHOUT_SIGNIN_SELECTORS = [
    'button:has-text("Continue without signing in")',
    'a:has-text("Continue without signing in")',
    'button:has-text("Use without an account")',
]
JOIN_BUTTON_SELECTORS = [
    'button[jsname="Qx7uuf"]',
    'button[jsname="V67aGc"]',
    'button:has-text("Ask to join")',
    'button:has-text("Join now")',
    'button:has-text("Request to join")',
    'button:has-text("Pedir para participar")',  # Portuguese
    'button:has-text("Demander à participer")',  # French
    'button:has-text("Unirse")',                 # Spanish
    'button:has-text("Teilnehmen")',             # German
    '[data-ved] button',
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


async def run_bot(bot_id: str) -> None:
    bot = bots.get(bot_id)
    if not bot:
        logger.error(f'[BotRunner] Bot {bot_id} not found in registry')
        return

    local_path = os.path.join('/tmp/recordings', f'{bot_id}.webm')
    capture = AudioCapture(bot_id, local_path)

    try:
        # --- JOINING ---
        bot.state = BotState.JOINING
        logger.info(f'[BotRunner] Bot {bot_id} joining: {bot.meeting_url}')

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

            await page.goto(bot.meeting_url, wait_until='networkidle', timeout=60_000)
            await asyncio.sleep(2)

            # Debug screenshot — see what the page looks like
            screenshot_path = f'{DEBUG_SCREENSHOT_DIR}/{bot_id}_01_loaded.png'
            await page.screenshot(path=screenshot_path)
            logger.info(f'[BotRunner] Screenshot saved: {screenshot_path}')

            # Handle "Continue without signing in" if present
            for selector in CONTINUE_WITHOUT_SIGNIN_SELECTORS:
                try:
                    btn = await page.wait_for_selector(selector, timeout=5_000)
                    if btn:
                        await btn.click()
                        logger.info(f'[BotRunner] Clicked continue without signing in')
                        await asyncio.sleep(2)
                        break
                except Exception:
                    continue

            # Fill guest name
            name_input = None
            for selector in GUEST_NAME_SELECTORS:
                try:
                    name_input = await page.wait_for_selector(selector, timeout=10_000)
                    if name_input:
                        break
                except Exception:
                    continue

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

            await browser.close()

        # --- UPLOADING ---
        bot.state = BotState.UPLOADING
        logger.info(f'[BotRunner] Bot {bot_id} stopping audio capture')

        await capture.stop()

        storage_path = f'{bot.user_id}/{bot.calendar_event_id}.webm'
        logger.info(f'[BotRunner] Uploading {local_path} → {storage_path}')
        await upload_to_supabase(local_path, storage_path)

        bot.audio_storage_path = storage_path
        bot.state = BotState.ENDED

        # Notify Vercel of state change (lightweight — no transcription triggered)
        await _send_webhook(bot.calendar_event_id, bot_id, 'ended')

        # Transcribe locally — avoids Vercel 300s function timeout for large audio files.
        # run_transcription pre-inserts the pending row, calls local Whisper, writes
        # segments to Supabase, then calls Vercel /generate-insights (fast AI-only route).
        asyncio.create_task(run_transcription(
            storage_path=storage_path,
            calendar_event_id=bot.calendar_event_id,
            user_id=bot.user_id,
            source='bot',
        ))

        # Clean up local file
        try:
            os.unlink(local_path)
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
