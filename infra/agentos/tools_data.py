"""
Data + web tools (Phase 4b) — thin HTTP wrappers over the Next.js internal API.

Same pattern as tools_tasks.py: Python @tool → POST {AUGMTD_INTERNAL_URL}
/api/internal/agentos/tools with the AGENTOS_SECRET bearer → the SAME executors
the native chat loop uses (lib/tools/*). External API keys (Tavily, Bedrock)
stay on Vercel. user_id comes from run_context; agent_id (for KB scoping) from
run_context.dependencies.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx
from agno.run import RunContext
from agno.tools import tool

INTERNAL_URL = os.getenv("AUGMTD_INTERNAL_URL", "").rstrip("/")
INTERNAL_SECRET = os.getenv("AGENTOS_SECRET", "")


def _call(action: str, run_context: RunContext, config: dict, needs_user: bool = True) -> str:
    if not INTERNAL_URL:
        return "Tool service not configured (AUGMTD_INTERNAL_URL unset)."
    user_id = run_context.user_id
    deps = run_context.dependencies or {}
    if needs_user and not user_id:
        return "No user context for this run."

    payload = {
        "action": action,
        "user_id": user_id,
        "agent_id": deps.get("agent_id"),
        "thread_id": deps.get("thread_id"),
        "config": config,
    }
    try:
        resp = httpx.post(
            f"{INTERNAL_URL}/api/internal/agentos/tools",
            json=payload,
            headers={"Authorization": f"Bearer {INTERNAL_SECRET}"},
            timeout=90.0,  # deep_research / fetch can be slow
        )
        if resp.status_code != 200:
            return f"Tool failed ({resp.status_code})."
        return resp.json().get("result", "")
    except Exception as e:  # noqa: BLE001
        return f"Tool service unreachable: {e}"


@tool
def get_emails(
    run_context: RunContext,
    mode: str = "recent",
    since: str = "7d",
    unread_only: bool = False,
    from_sender: Optional[str] = None,
    topic: Optional[str] = None,
    limit: int = 15,
) -> str:
    """Read the user's inbox. Use for "what's in my inbox", "any emails from X",
    "urgent emails", or to gather material before drafting.

    Args:
        mode: "recent" or "urgent".
        since: Lookback window, e.g. "7d", "30d".
        unread_only: Only unread items.
        from_sender: Filter by sender name/email substring.
        topic: Keyword/topic to match.
        limit: Max emails (1-50).
    """
    config = {"mode": mode, "since": since, "unread_only": unread_only, "limit": limit}
    if from_sender:
        config["from"] = from_sender
    if topic:
        config["topic"] = topic
    return _call("get_emails", run_context, config)


@tool
def get_meeting_context(
    run_context: RunContext,
    since: str = "30d",
    include: str = "summaries",
    with_person: Optional[str] = None,
) -> str:
    """Read the user's calendar and past meeting notes. Use to prep for meetings,
    recall what was discussed, or find meetings with a person.

    Args:
        since: Lookback window, e.g. "30d".
        include: "summaries" or "transcripts".
        with_person: Filter to meetings with this person.
    """
    config = {"since": since, "include": include}
    if with_person:
        config["with_person"] = with_person
    return _call("get_meeting_context", run_context, config)


@tool
def search_knowledge_base(run_context: RunContext, query: str) -> str:
    """Search the user's indexed files and Drive documents for relevant content.

    Args:
        query: Specific search query.
    """
    return _call("search_knowledge_base", run_context, {"query": query})


@tool
def web_search(run_context: RunContext, query: str, max_results: int = 6) -> str:
    """Search the live web for current information, news, or research on any topic.
    Call immediately when the user asks about anything current.

    Args:
        query: Search query.
        max_results: Number of results (default 6, max 10).
    """
    return _call("web_search", run_context, {"query": query, "max_results": max_results}, needs_user=False)


@tool
def fetch_url(run_context: RunContext, urls: list) -> str:
    """Fetch and read the full content of one or more URLs.

    Args:
        urls: List of URLs to fetch.
    """
    return _call("fetch_url", run_context, {"urls": urls}, needs_user=False)


@tool
def deep_research(run_context: RunContext, focus: str, model: str = "fast") -> str:
    """Multi-source research synthesis for complex topics. Hits multiple sources,
    cross-references, and returns a structured synthesis with citations.

    Args:
        focus: The research focus / question.
        model: "fast" or "thorough".
    """
    return _call("deep_research", run_context, {"focus": focus, "model": model}, needs_user=False)


@tool
def generate_document(
    run_context: RunContext,
    type: str,
    instructions: str,
    grounding: Optional[str] = None,
) -> str:
    """Produce a downloadable deliverable (Word doc, Excel sheet, PowerPoint, or
    email draft) and attach it to this conversation. Call when the user asks for a
    document, spreadsheet, presentation, deck, report, or email to send/download.
    Gather the source material first (search_knowledge_base / get_emails / web),
    then pass it in `grounding` so the document is based on real content.

    Args:
        type: One of "word", "excel", "pptx", "email".
        instructions: Detailed description of what to produce (title, sections, content).
        grounding: Optional source material to base the document on (KB/email/web content you fetched).
    """
    config = {"type": type, "instructions": instructions}
    if grounding:
        config["grounding"] = grounding
    return _call("generate_document", run_context, config)


# Data + web tools — assigned to every worker (matches all_tools in native loop).
DATA_TOOLS = [
    get_emails, get_meeting_context, search_knowledge_base,
    web_search, fetch_url, deep_research, generate_document,
]
