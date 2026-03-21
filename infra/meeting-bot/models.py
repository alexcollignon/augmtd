import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class BotState(str, Enum):
    SCHEDULED = "scheduled"
    JOINING = "joining"
    RECORDING = "recording"
    UPLOADING = "uploading"
    ENDED = "ended"
    FAILED = "failed"


@dataclass
class BotRecord:
    bot_id: str
    meeting_url: str
    join_at: str            # ISO string
    calendar_event_id: str  # for webhook URL construction
    user_id: str            # for storage path prefix
    bot_name: str
    google_access_token: Optional[str] = None  # user's OAuth access token for browser auth
    state: BotState = BotState.SCHEDULED
    audio_storage_path: Optional[str] = None
    error: Optional[str] = None
    task: Optional[asyncio.Task] = field(default=None, repr=False)


# In-memory bot registry
bots: dict[str, BotRecord] = {}
