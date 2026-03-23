"""
Email backfill worker — runs entirely on Hetzner, no Vercel timeout risk.

Flow:
  1. Fetch batch of parsed emails from Vercel /api/email/fetch-batch (no AI, just parse)
  2. For each email, call Vercel /api/email/process-single (AI + DB writes)
  3. Update backfill progress in Supabase after each chunk
"""

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
BOT_SECRET = os.getenv('BOT_SECRET', '')

CHUNK_SIZE = 25
REQUEST_TIMEOUT = 55  # seconds — under Vercel's 60s maxDuration


async def _fetch_batch(
    connection_id: str,
    user_id: str,
    offset: int,
    limit: int,
    app_url: str,
) -> list[dict]:
    """Fetch a batch of raw parsed emails from Vercel (no AI)."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(
            f'{app_url}/api/email/fetch-batch',
            json={'connectionId': connection_id, 'userId': user_id, 'offset': offset, 'limit': limit},
            headers={'Authorization': f'Bearer {BOT_SECRET}'},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get('emails', [])


async def _process_single(
    connection_id: str,
    user_id: str,
    parsed_email: dict,
    app_url: str,
) -> dict:
    """Run AI pipeline for one email via Vercel."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(
            f'{app_url}/api/email/process-single',
            json={'connectionId': connection_id, 'userId': user_id, 'parsedEmail': parsed_email},
            headers={'Authorization': f'Bearer {BOT_SECRET}'},
        )
        resp.raise_for_status()
        return resp.json()


async def _update_backfill_progress(connection_id: str, done: int, status: str = 'running') -> None:
    """Update backfill progress directly in Supabase."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        await client.patch(
            f'{SUPABASE_URL}/rest/v1/connections',
            params={'id': f'eq.{connection_id}'},
            json={'backfill_emails_done': done, 'backfill_status': status},
            headers={
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
        )


async def run_email_backfill(
    connection_id: str,
    user_id: str,
    max_emails: int,
    app_url: str,
) -> None:
    """
    Background task: backfill historical emails for a connection.
    Runs entirely on Hetzner — Vercel fn just triggers this and returns 202.
    """
    logger.info(f'[EmailBackfill] Starting — connection={connection_id} max={max_emails}')
    offset = 0
    total_processed = 0

    try:
        while offset < max_emails:
            limit = min(CHUNK_SIZE, max_emails - offset)

            emails = await _fetch_batch(connection_id, user_id, offset, limit, app_url)
            if not emails:
                logger.info(f'[EmailBackfill] No more emails at offset {offset} — done')
                break

            for email in emails:
                try:
                    result = await _process_single(connection_id, user_id, email, app_url)
                    total_processed += 1
                    logger.info(
                        f'[EmailBackfill] Processed {total_processed}/{max_emails} '
                        f'— inbox_items_created={result.get("inboxItemsCreated", 0)}'
                    )
                except Exception as e:
                    logger.error(f'[EmailBackfill] Failed to process email: {e}')
                    # Continue with next email — don't abort the whole backfill

                # Throttle to avoid AI rate limits
                await asyncio.sleep(0.2)

            offset += len(emails)
            await _update_backfill_progress(connection_id, total_processed)

        await _update_backfill_progress(connection_id, total_processed, status='completed')
        logger.info(f'[EmailBackfill] ✓ Completed — {total_processed} emails processed')

    except Exception as e:
        logger.error(f'[EmailBackfill] ✗ Failed: {e}')
        await _update_backfill_progress(connection_id, total_processed, status='failed')
