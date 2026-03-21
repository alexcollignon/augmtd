import logging
import os

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
BUCKET = 'meeting-recordings'


async def upload_to_supabase(local_path: str, storage_path: str) -> str:
    """
    Upload a local file to Supabase Storage via HTTP PUT.
    Returns the storage_path on success.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured')

    url = f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}'

    logger.info(f'[Storage] Uploading {local_path} → {storage_path} ({url})')

    file_size = os.path.getsize(local_path)
    logger.info(f'[Storage] File size: {file_size} bytes')

    async with httpx.AsyncClient(timeout=300.0) as client:
        with open(local_path, 'rb') as f:
            response = await client.put(
                url,
                content=f.read(),
                headers={
                    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                    'Content-Type': 'audio/webm',
                    'x-upsert': 'true',
                },
            )

    if response.status_code not in (200, 201):
        raise RuntimeError(f'Supabase Storage PUT failed: {response.status_code} {response.text}')

    logger.info(f'[Storage] Upload complete: {storage_path}')
    return storage_path
