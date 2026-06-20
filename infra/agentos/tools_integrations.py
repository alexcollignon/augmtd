"""
Integration tools (Slack, …) — thin HTTP wrappers over the Next.js internal API.

Like tools_data.py: POST {AUGMTD_INTERNAL_URL}/api/internal/agentos/tools with the
shared AGENTOS_SECRET bearer. The intelligence + token handling (via self-hosted
Nango) stays in TypeScript on Vercel — single source of truth, RLS-safe, and the
box never holds OAuth tokens. user_id + agent_id come from the run context.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx
from agno.run import RunContext
from agno.tools import tool

INTERNAL_URL = os.getenv("AUGMTD_INTERNAL_URL", "").rstrip("/")
INTERNAL_SECRET = os.getenv("AGENTOS_SECRET", "")


def _call(action: str, run_context: RunContext, config: dict) -> str:
    if not INTERNAL_URL:
        return "Integration service not configured (AUGMTD_INTERNAL_URL unset)."
    user_id = run_context.user_id
    if not user_id:
        return "No user context for this run."
    deps = run_context.dependencies or {}
    payload = {
        "action": action,
        "user_id": user_id,
        "agent_id": deps.get("agent_id"),
        "config": config,
    }
    try:
        resp = httpx.post(
            f"{INTERNAL_URL}/api/internal/agentos/tools",
            json=payload,
            headers={"Authorization": f"Bearer {INTERNAL_SECRET}"},
            timeout=60.0,
        )
        if resp.status_code != 200:
            return f"Integration action failed ({resp.status_code})."
        return resp.json().get("result", "Done.")
    except Exception as e:  # noqa: BLE001
        return f"Integration service unreachable: {e}"


@tool
def slack_list_channels(run_context: RunContext) -> str:
    """List the Slack channels the team's app can see (public + private it's in),
    to resolve a channel name to an id. Call before posting or reading by name."""
    return _call("slack_list_channels", run_context, {})


@tool
def slack_read_messages(run_context: RunContext, channel: str, limit: int = 20) -> str:
    """Read recent messages from a Slack channel or DM the app is a member of
    (to catch up, summarize, or answer about a conversation). The app must be in it.

    Args:
        channel: Channel or DM id (C0123ABCD, G…, D…). Resolve names via slack_list_channels.
        limit: How many recent messages to fetch (default 20, max 100).
    """
    return _call("slack_read_messages", run_context, {"channel": channel, "limit": limit})


@tool
def slack_post_message(run_context: RunContext, channel: str, text: str) -> str:
    """Post a message to a Slack channel, as this coworker (their name + avatar).
    The app must already be invited to the channel.

    Args:
        channel: Channel id (preferred, e.g. C0123ABCD) or name (e.g. #general).
        text: Message text. Slack mrkdwn: *bold*, _italic_, <url|label>.
    """
    return _call("slack_post_message", run_context, {"channel": channel, "text": text})


INTEGRATION_TOOLS = [slack_list_channels, slack_post_message, slack_read_messages]
