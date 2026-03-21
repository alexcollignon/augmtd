"""
Interactive Google login — run inside the container via:
  docker exec -it augmtd_meeting-bot_1 python3 /app/google-login-interactive.py

Fills credentials automatically, then waits for you to enter the SMS code in the terminal.
Saves session to /app/google-auth.json when done.
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright


EMAIL = 'augmtd.bot@gmail.com'
PASSWORD = 'Lisbonne9'
AUTH_OUTPUT = '/app/google-auth.json'
SCREENSHOT_DIR = '/tmp'
# Must match the PROXY_URL used by bot_runner — same IP = no re-challenge
PROXY_URL = os.getenv('PROXY_URL', '')


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        )
        proxy = {'server': PROXY_URL} if PROXY_URL else None
        if proxy:
            print(f'  Using residential proxy (PROXY_URL set)')
        else:
            print('  WARNING: No PROXY_URL set — Google may challenge from this datacenter IP')

        context = await browser.new_context(
            proxy=proxy,
            user_agent=(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/124.0.0.0 Safari/537.36'
            )
        )
        page = await context.new_page()

        print('[1/6] Navigating to Google sign-in...')
        await page.goto('https://accounts.google.com/signin/v2/identifier', wait_until='networkidle')
        await asyncio.sleep(2)

        print('[2/6] Filling email...')
        await page.fill('input[type="email"]', EMAIL)
        await page.screenshot(path=f'{SCREENSHOT_DIR}/login_01_email.png')
        await page.keyboard.press('Enter')
        await asyncio.sleep(3)

        print('[3/6] Filling password...')
        try:
            await page.wait_for_selector('input[type="password"]', timeout=10_000)
        except Exception:
            await page.screenshot(path=f'{SCREENSHOT_DIR}/login_02_after_email.png')
            print(f'  Screenshot: {SCREENSHOT_DIR}/login_02_after_email.png')
            print('  Could not find password field. See screenshot.')
            await browser.close()
            return

        await page.fill('input[type="password"]', PASSWORD)
        await page.screenshot(path=f'{SCREENSHOT_DIR}/login_03_password.png')
        await page.keyboard.press('Enter')
        await asyncio.sleep(5)

        url = page.url
        print(f'  URL after password: {url}')
        await page.screenshot(path=f'{SCREENSHOT_DIR}/login_04_after_password.png')
        print(f'  Screenshot: {SCREENSHOT_DIR}/login_04_after_password.png')

        # Check if we need 2FA / phone verification
        challenge_keywords = ['challenge', 'signin/v2/challenge', 'totp', 'smsauthinterstitial', 'verify']
        needs_challenge = any(k in url.lower() for k in challenge_keywords)

        if needs_challenge:
            print('\n[4/6] Google is asking for verification.')

            # Try to click "Send SMS" / "Use your phone" option if available
            sms_selectors = [
                'div[data-challengetype="9"]',   # SMS option
                'li[data-challengetype="9"]',
                'div[data-challengetype="11"]',  # phone prompt
                'button:has-text("Send")',
                'button:has-text("Get a code")',
                '[aria-label*="phone"]',
            ]
            clicked_sms = False
            for sel in sms_selectors:
                try:
                    el = await page.wait_for_selector(sel, timeout=3_000)
                    if el:
                        await el.click()
                        print(f'  Clicked SMS option ({sel})')
                        clicked_sms = True
                        await asyncio.sleep(3)
                        break
                except Exception:
                    continue

            if not clicked_sms:
                print('  Could not auto-click SMS option — it may already be showing the code input.')

            await page.screenshot(path=f'{SCREENSHOT_DIR}/login_05_challenge.png')
            print(f'  Screenshot: {SCREENSHOT_DIR}/login_05_challenge.png')
            print()
            print('  *** CHECK YOUR PHONE for an SMS from Google ***')
            code = input('  Enter the verification code: ').strip()

            # Fill the code
            code_selectors = [
                'input[type="tel"]',
                'input[name="code"]',
                'input[aria-label*="code" i]',
                'input[aria-label*="Code" i]',
                'input[autocomplete="one-time-code"]',
            ]
            filled = False
            for sel in code_selectors:
                try:
                    el = await page.wait_for_selector(sel, timeout=5_000)
                    if el:
                        await el.fill(code)
                        filled = True
                        print(f'  Filled code into {sel}')
                        break
                except Exception:
                    continue

            if not filled:
                await page.screenshot(path=f'{SCREENSHOT_DIR}/login_06_code_field_missing.png')
                print(f'  Could not find code input field. Screenshot: {SCREENSHOT_DIR}/login_06_code_field_missing.png')
                await browser.close()
                return

            await page.keyboard.press('Enter')
            await asyncio.sleep(5)

            url = page.url
            print(f'  URL after code: {url}')
            await page.screenshot(path=f'{SCREENSHOT_DIR}/login_06_after_code.png')
            print(f'  Screenshot: {SCREENSHOT_DIR}/login_06_after_code.png')

        else:
            print('[4/6] No challenge detected — proceeding.')

        # Check if we're signed in
        final_url = page.url
        print(f'\n[5/6] Final URL: {final_url}')

        if 'myaccount.google.com' in final_url or 'mail.google.com' in final_url or 'google.com/u/' in final_url:
            print('  ✓ Signed in successfully!')
        elif 'accounts.google.com' in final_url:
            await page.screenshot(path=f'{SCREENSHOT_DIR}/login_final.png')
            print(f'  Still on accounts.google.com — may need more steps.')
            print(f'  Screenshot: {SCREENSHOT_DIR}/login_final.png')
            proceed = input('  Save anyway? (y/n): ').strip().lower()
            if proceed != 'y':
                await browser.close()
                return
        else:
            print('  Session appears valid.')

        print(f'\n[6/6] Saving session to {AUTH_OUTPUT}...')
        await context.storage_state(path=AUTH_OUTPUT)
        print(f'  ✓ Saved {AUTH_OUTPUT}')

        await browser.close()
        print('\nDone. Restart the bot container for the new auth to take effect:')
        print('  docker-compose restart meeting-bot')


asyncio.run(main())
