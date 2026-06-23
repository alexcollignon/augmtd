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
def slack_list_members(run_context: RunContext, channel: str) -> str:
    """List the people in a Slack channel (names + ids) — use this to find the right
    person to @-mention before posting, instead of guessing. Then write <@Their Name>.

    Args:
        channel: Channel id (C0123ABCD, G…) or name. Resolve names via slack_list_channels.
    """
    return _call("slack_list_members", run_context, {"channel": channel})


@tool
def slack_read_messages(run_context: RunContext, channel: str, limit: int = 20, days: int = 0) -> str:
    """Read recent messages from a Slack channel or DM the app is a member of
    (to catch up, summarize, or answer about a conversation). The app must be in it.

    Args:
        channel: Channel or DM id (C0123ABCD, G…, D…). Resolve names via slack_list_channels.
        limit: How many recent messages to fetch (default 20, max 100).
        days: Optional time window — only messages from the last N days (e.g. 7). 0 = no limit.
    """
    args = {"channel": channel, "limit": limit}
    if days:
        args["days"] = days
    return _call("slack_read_messages", run_context, args)


@tool
def slack_post_message(run_context: RunContext, channel: str, text: str, thread_ts: str = "") -> str:
    """Post a message to a Slack channel as yourself (your own Slack app). The app
    must already be in the channel. You can @-mention people and reply in threads.

    Args:
        channel: Channel id (e.g. C0123ABCD) or name (e.g. #general). Use "@me" to
            send the user a direct message instead of posting to a channel.
        text: Message text (Slack mrkdwn). To @-mention someone write
            <@their-email@example.com> or <@me> for the user; <!channel>/<!here> also work.
        thread_ts: Optional. Reply inside a thread — pass the parent message ts
            (from slack_read_messages, shown as [ts:…]).
    """
    args = {"channel": channel, "text": text}
    if thread_ts:
        args["thread_ts"] = thread_ts
    return _call("slack_post_message", run_context, args)


@tool
def compose_email(run_context: RunContext, to: list, subject: str, body: str, cc: list = None) -> str:
    """Draft an email for the user to review and SEND — you do NOT send it. It shows the
    user an editable draft (recipients, subject, body) that they edit and click Send.
    Never claim the email was sent. Use whenever the user asks you to email someone.
    Recipients can be anyone; for "me"/"us" use the user's own address from the
    [YOUR EMAIL ADDRESSES] context.

    Args:
        to: Recipient email address(es).
        subject: Email subject.
        body: Email body — plain prose, blank line between paragraphs; **bold** allowed.
        cc: Optional cc address(es).
    """
    args = {"to": to or [], "subject": subject, "body": body}
    if cc:
        args["cc"] = cc
    return _call("compose_email", run_context, args)


@tool
def present_linkedin_post(run_context: RunContext, variants: list) -> str:
    """Present a drafted LinkedIn post to the user as a rich, reviewable card (with a faithful
    preview, character count, and the "…see more" fold marker). Call this WHEN you've written
    a LinkedIn post the user should review — put the post text HERE, not in your chat reply.
    Display-only: it does not publish. After calling it, keep your reply short (e.g. a one-line
    intro); the card shows the post.

    Args:
        variants: 1–3 post options, each a dict {"text": "the full post", "hashtags": ["tag", …]}.
                  Provide multiple only if you genuinely drafted alternative angles.
    """
    return _call("present_linkedin_post", run_context, {"variants": variants or []})


INTEGRATION_TOOLS = [slack_list_channels, slack_post_message, slack_read_messages, slack_list_members, compose_email, present_linkedin_post]
