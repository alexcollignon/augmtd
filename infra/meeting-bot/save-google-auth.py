"""
One-time script — run locally on your Mac to save the bot's Google session.
Usage: python3 save-google-auth.py
"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir='/tmp/augmtd-bot-profile',
            headless=False,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        page = await context.new_page()

        print("Opening Google sign-in...")
        await page.goto("https://accounts.google.com")

        print("\n→ Sign in with the bot Gmail account in the browser window that just opened.")
        print("→ Once fully signed in (you see your account dashboard), come back here and press Enter.")
        input("\nPress Enter when signed in: ")

        # Save session cookies + storage to a file
        await context.storage_state(path="google-auth.json")
        print("\n✓ Session saved to google-auth.json")
        print("  Upload it to the server with:")
        print("  scp google-auth.json root@46.224.176.245:/root/augmtd-infra/infra/meeting-bot/")

        await context.close()

asyncio.run(main())
