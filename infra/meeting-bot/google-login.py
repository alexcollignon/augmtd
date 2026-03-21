import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        context = await browser.new_context()
        page = await context.new_page()

        print('Navigating to Google sign-in...')
        await page.goto('https://accounts.google.com')
        await asyncio.sleep(2)

        await page.fill('input[type="email"]', 'augmtd.bot@gmail.com')
        await page.click('button:has-text("Next")')
        await asyncio.sleep(3)

        await page.fill('input[type="password"]', 'Lisbonne9')
        await page.click('button:has-text("Next")')
        await asyncio.sleep(8)

        url = page.url
        print(f'Current URL: {url}')

        await page.screenshot(path='/tmp/google-login-state.png')
        print('Screenshot saved to /tmp/google-login-state.png')

        await context.storage_state(path='/app/google-auth.json')
        print('Saved /app/google-auth.json')
        await browser.close()


asyncio.run(main())
