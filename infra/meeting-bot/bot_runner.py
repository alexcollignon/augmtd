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
    # "You left" strings
    'h1:has-text("You\'ve left the call")',
    'h1:has-text("Saiu da reunião")',
    'h1:has-text("Has salido de la videollamada")',
    'h1:has-text("Vous avez quitté")',
    'h1:has-text("Sie haben das Meeting verlassen")',
    # "Host ended the meeting" strings
    'h1:has-text("A reunião terminou")',
    'h1:has-text("Chamada terminada")',
    'h1:has-text("The meeting has ended")',
    'h1:has-text("La llamada ha finalizado")',
    'h1:has-text("L\'appel a pris fin")',
    'h1:has-text("Das Meeting wurde beendet")',
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
    Poll Google Meet's live captions DOM every 2s.
    Uses confirmed CueMeet selectors: [role="region"][aria-label~="caption/legenda"]
    → .nMcdL blocks → .NWpY1d (speaker name) + .bh44bd/.VbkSUe (text).
    Falls back to jsname="tgaKEf" and a global .nMcdL scan.
    """
    dumped_html = False
    while not stop_event.is_set():
        try:
            result = await page.evaluate("""
                (() => {
                    const results = [];
                    const seen = new Set();
                    let debugHtml = null;

                    function isSpeechText(t) {
                        if (!t || t.length > 300) return false;
                        if (/\bBETA\b/.test(t)) return false;
                        return t.trim().length > 2;
                    }

                    function addEntry(speaker, text, source) {
                        if (!speaker || !text) return;
                        speaker = speaker.trim();
                        text = text.trim();
                        if (!speaker || !isSpeechText(text)) return;
                        const key = speaker + '|' + text;
                        if (!seen.has(key)) {
                            seen.add(key);
                            results.push({ speaker, text });
                            if (!debugHtml) {
                                debugHtml = '[' + source + '] speaker=' + speaker + ' | text=' + text.slice(0, 80);
                            }
                        }
                    }

                    function extractFromRegion(container, source) {
                        // Use confirmed CueMeet selectors: .nMcdL block → .NWpY1d + .bh44bd
                        container.querySelectorAll('.nMcdL, [jsname="nMcdL"]').forEach(block => {
                            const nameEl = block.querySelector('.NWpY1d, [jsname="NWpY1d"]');
                            const textEl = block.querySelector('.bh44bd, [jsname="bh44bd"]') ||
                                           block.querySelector('.VbkSUe');
                            addEntry(nameEl && nameEl.textContent, textEl && textEl.textContent, source);
                        });
                    }

                    // Strategy 1: [role="region"] with aria-label matching captions (most stable)
                    Array.from(document.querySelectorAll('[role="region"]'))
                        .filter(r => /caption|legenda|subtitl/i.test(r.getAttribute('aria-label') || ''))
                        .forEach(r => extractFromRegion(r, 'region'));

                    // Strategy 2: jsname="tgaKEf" — older/parallel Meet renderer
                    document.querySelectorAll('[jsname="tgaKEf"]')
                        .forEach(el => extractFromRegion(el, 'tgaKEf'));

                    // Strategy 3: global .nMcdL scan (if nothing found above)
                    if (results.length === 0) {
                        const blocks = document.querySelectorAll('.nMcdL');
                        blocks.forEach(block => {
                            const nameEl = block.querySelector('.NWpY1d');
                            const textEl = block.querySelector('.bh44bd') || block.querySelector('.VbkSUe');
                            addEntry(nameEl && nameEl.textContent, textEl && textEl.textContent, 'nMcdL-global');
                        });
                    }

                    return { results, debugHtml };
                })()
            """)
            entries = result.get('results', [])
            debug_html = result.get('debugHtml')
            if debug_html and not dumped_html:
                logger.info(f'[BotRunner] Caption DOM: {debug_html}')
                dumped_html = True
            if entries and len(caption_log) < 3:
                logger.info(f'[BotRunner] Caption sample: {entries[:2]}')
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

            CC_PATTERN = r'caption|subtitle|legenda|l\u00e9gende|untertitel|ondertitel|didascal|altyaz|subt\u00edt|\u043f\u043e\u0434\u043f\u0438\u0441|\u5b57\u5e55'
            DISABLE_CC_PATTERN = r'desativar legendas|turn off captions|disable captions|d\u00e9sactiver|untertitel deaktivieren'

            async def _confirm_cc_on() -> bool:
                """Check if captions are confirmed ON (disable button visible)."""
                try:
                    return await page.evaluate(f"""
                        (() => {{
                            const p = /{DISABLE_CC_PATTERN}/i;
                            return Array.from(document.querySelectorAll('button[aria-label]'))
                                .some(b => p.test(b.getAttribute('aria-label')));
                        }})()
                    """)
                except Exception:
                    return False

            async def _handle_language_panel():
                """If language selection panel appeared, click English/selected option then Escape."""
                try:
                    lang = await page.evaluate("""
                        (() => {
                            const prefer = /^(ingl\u00eas|english)$/i;
                            const opts = Array.from(document.querySelectorAll('[role="option"], [role="radio"], li[data-value]'));
                            const eng = opts.find(o => prefer.test(o.textContent.trim()));
                            if (eng) { eng.click(); return eng.textContent.trim(); }
                            const sel = opts.find(o => o.getAttribute('aria-selected') === 'true' || o.getAttribute('aria-checked') === 'true');
                            if (sel) { sel.click(); return sel.textContent.trim(); }
                            return null;
                        })()
                    """)
                    if lang:
                        logger.info(f'[BotRunner] Selected caption language: "{lang}"')
                        await asyncio.sleep(0.5)
                except Exception:
                    pass
                try:
                    await page.keyboard.press('Escape')
                    await asyncio.sleep(0.3)
                except Exception:
                    pass

            # Sleep 3s for toolbar to render, then try CC enable up to 3 times
            await asyncio.sleep(3)
            cc_enabled = False

            for attempt in range(3):
                # Wake toolbar with mouse move
                try:
                    await page.mouse.move(640, 360)
                    await page.mouse.move(640, 650)
                    await asyncio.sleep(0.5)
                except Exception:
                    pass

                # Try direct toolbar button
                try:
                    clicked_label = await page.evaluate(f"""
                        (() => {{
                            const pattern = /{CC_PATTERN}/i;
                            const btn = Array.from(document.querySelectorAll('button[aria-label]'))
                                .find(b => pattern.test(b.getAttribute('aria-label')));
                            if (btn) {{ btn.click(); return btn.getAttribute('aria-label'); }}
                            return null;
                        }})()
                    """)
                except Exception:
                    clicked_label = None

                if clicked_label:
                    logger.info(f'[BotRunner] Clicked CC button: "{clicked_label}" (attempt {attempt+1})')
                    await asyncio.sleep(1.0)
                    await _handle_language_panel()
                    await asyncio.sleep(0.5)
                    if await _confirm_cc_on():
                        logger.info('[BotRunner] Captions confirmed ON')
                        cc_enabled = True
                        break
                    # Button might have been "Desativar" (was already on) — re-enable
                    logger.warning('[BotRunner] CC not confirmed after click — retrying')
                    continue

                # Toolbar button not found — try overflow menu once
                if attempt == 1:
                    try:
                        opened = await page.evaluate("""
                            (() => {
                                const exact = [
                                    'Mais op\u00e7\u00f5es', 'More options', 'M\u00e1s opciones',
                                    "Plus d'options", 'Weitere Optionen', 'Meer opties',
                                    'Altre opzioni', 'Daha fazla se\u00e7enek', '\u66f4\u591a\u9009\u9879'
                                ];
                                const btn = Array.from(document.querySelectorAll('button[aria-label]'))
                                    .find(b => exact.includes(b.getAttribute('aria-label')));
                                if (btn) { btn.click(); return btn.getAttribute('aria-label'); }
                                return null;
                            })()
                        """)
                        if opened:
                            logger.info(f'[BotRunner] Opened overflow menu: "{opened}"')
                            await asyncio.sleep(0.5)
                            clicked_label = await page.evaluate(f"""
                                (() => {{
                                    const pattern = /{CC_PATTERN}/i;
                                    const btn = Array.from(document.querySelectorAll(
                                        'button[aria-label], [role="menuitem"], [role="option"]'
                                    )).find(b => pattern.test(b.getAttribute('aria-label') || b.textContent));
                                    if (btn) {{ btn.click(); return btn.getAttribute('aria-label') || btn.textContent.trim(); }}
                                    return null;
                                }})()
                            """)
                            if clicked_label:
                                logger.info(f'[BotRunner] Clicked CC in overflow: "{clicked_label}"')
                                await asyncio.sleep(1.0)
                                await _handle_language_panel()
                                if await _confirm_cc_on():
                                    logger.info('[BotRunner] Captions confirmed ON via overflow')
                                    cc_enabled = True
                                    break
                            else:
                                logger.warning('[BotRunner] CC not found in overflow menu')
                                await page.keyboard.press('Escape')
                    except Exception as overflow_exc:
                        logger.warning(f'[BotRunner] Overflow failed: {overflow_exc}')

            if not cc_enabled:
                # Final fallback: 'c' keyboard shortcut
                await page.keyboard.press('c')
                await asyncio.sleep(1.0)
                if await _confirm_cc_on():
                    logger.info('[BotRunner] Captions confirmed ON via "c" keystroke')
                    cc_enabled = True
                else:
                    logger.warning('[BotRunner] Could not enable captions — speaker ID will be unavailable')

            # Log all buttons + aria-live regions for debugging
            await asyncio.sleep(1)
            try:
                cc_snap = await page.evaluate("""
                    (() => {
                        const live = Array.from(document.querySelectorAll('[aria-live]'))
                            .map(el => ({ aria: el.getAttribute('aria-live'), jsname: el.getAttribute('jsname'), childCount: el.children.length }));
                        const all_btns = Array.from(document.querySelectorAll('button[aria-label]'))
                            .map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 20);
                        return { live_regions: live, all_btns };
                    })()
                """)
                logger.info(f'[BotRunner] CC snap: {cc_snap}')
            except Exception as cc_snap_exc:
                logger.warning(f'[BotRunner] CC snap failed: {cc_snap_exc}')

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

                # Also detect if page navigated away from meet.google.com
                if not meeting_ended:
                    try:
                        if 'meet.google.com' not in page.url:
                            meeting_ended = True
                    except Exception:
                        pass

                if meeting_ended:
                    logger.info(f'[BotRunner] Bot {bot_id} detected meeting ended after {elapsed}s')
                    break

                # Detect "bot is alone" — exit after 2min with ≤1 participant tile
                # data-participant-id counts OTHER participants' video tiles (bot has no tile
                # in headless mode, so count=0 means nobody else, count≥1 means others present)
                try:
                    participant_count = await page.evaluate("""() => {
                        const byTile = document.querySelectorAll('[data-participant-id]').length;
                        const byRow  = document.querySelectorAll('[jsname="bnCOle"], [jsname="rn3Vkc"]').length;
                        return Math.max(byTile, byRow);
                    }""")
                    if participant_count <= 1:
                        if alone_since is None:
                            alone_since = elapsed
                            logger.info(f'[BotRunner] Bot {bot_id} appears to be alone (count={participant_count})')
                        elif elapsed - alone_since >= 30:  # 30 seconds
                            logger.info(f'[BotRunner] Bot {bot_id} alone for 30s — ending recording')
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

        # Clean up local audio file (caption file is cleaned up by transcription_worker after reading)
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
