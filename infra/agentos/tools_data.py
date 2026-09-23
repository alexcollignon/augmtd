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

    # THE USER'S OWN WORDS + THE TURN TOKEN ride to the internal door (W4-C, Sep 22).
    # `user_text` is what arming/deed floors decided in code read — never the model's extraction
    # (absent, those floors fail closed). `turn_id` stamps anything this call leaves in the
    # presentation side-channel, so a card is only ever served to the turn that made it.
    payload = {
        "action": action,
        "user_id": user_id,
        "agent_id": deps.get("agent_id"),
        "thread_id": deps.get("thread_id"),
        "user_text": deps.get("user_text") or "",
        "turn_id": deps.get("turn_id") or "",
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
    include_upcoming: bool = True,
) -> str:
    """Read the user's calendar and past meeting notes. Use to prep for meetings,
    recall what was discussed, or find meetings with a person.

    Args:
        since: Lookback window, e.g. "30d".
        include: "summaries" or "transcripts".
        with_person: Filter to meetings with this person.
        include_upcoming: Also include upcoming calendar events for the next 7 days. Default: true.
    """
    config = {"since": since, "include": include, "include_upcoming": include_upcoming}
    if with_person:
        config["with_person"] = with_person
    return _call("get_meeting_context", run_context, config)


@tool
def check_calendar(
    run_context: RunContext,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    propose_slots: bool = False,
    duration_minutes: int = 30,
    count: int = 3,
    refresh: bool = False,
) -> str:
    """Read the user's calendar for a date range — busy/free per day, and optionally propose
    genuinely free slots. ALWAYS use this before any claim about availability, free time, or
    scheduling. Never state availability from memory.

    Args:
        from_date: First day, YYYY-MM-DD. Default: today.
        to_date: Last day, YYYY-MM-DD. Default: 14 days after from_date. Window is capped at 60 days.
        propose_slots: Also propose free working-hour slots inside the window.
        duration_minutes: Length of a proposed slot in minutes. Default 30.
        count: How many slots to propose. Default 3, max 5.
        refresh: Re-read the calendar from the provider first. Set this when the user says they
            just changed, added or deleted something.
    """
    config: dict = {"propose_slots": propose_slots, "duration_minutes": duration_minutes, "count": count, "refresh": refresh}
    if from_date:
        config["from_date"] = from_date
    if to_date:
        config["to_date"] = to_date
    return _call("check_calendar", run_context, config)


@tool
def prepare_event_action(
    run_context: RunContext,
    which: Optional[str] = None,
    verb: Optional[str] = None,
) -> str:
    """Show ONE meeting already on the user's calendar as a card, with the actions its own state
    allows (accept / maybe / decline an invitation · reschedule or cancel a meeting they organize).
    Call this whenever the user talks about a specific existing meeting — "what's my 3pm with
    Sam?", "decline the standup", "move my call to Thursday 10:00", "cancel tomorrow's sync".
    It NEVER changes anything: it prepares the card and the user's click is the deed. Use
    prepare_calendar_invite instead when there is no such meeting yet and one must be created.

    THE PRESENTATION LAW (Sep 22): the result describes the card the user can now SEE. Reply with
    one short line — do not restate the meeting's details; the card carries them.

    Args:
        which: Which meeting, in the user's own words ("the 3pm with Sam", "tomorrow's sync").
        verb: The action the user asked for, if they asked for one — accept, tentative, decline,
            reschedule or cancel. Omit when they only asked about the meeting.
    """
    config: dict = {}
    if which:
        config["which"] = which
    if verb:
        config["verb"] = verb
    return _call("prepare_event_action", run_context, config)


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
def fetch_url(run_context: RunContext, urls: list, max_age_days: Optional[int] = None) -> str:
    """Fetch and read the full content of one or more URLs.

    Args:
        urls: List of URLs to fetch (max 5).
        max_age_days: Optional freshness guard — pages whose detected publication date is older
            than this many days are dropped (replaced by a skip note). Pages with no detectable
            date are kept but flagged UNDATED.
    """
    config: dict = {"urls": urls}
    if max_age_days:
        config["max_age_days"] = max_age_days
    return _call("fetch_url", run_context, config, needs_user=False)


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


@tool
def run_compute(
    run_context: RunContext,
    script: str,
    description: Optional[str] = None,
    file_ids: Optional[list] = None,
    data: Optional[str] = None,
    timeout_s: Optional[int] = None,
) -> str:
    """Run a Python script in a locked sandbox over files the user already has
    (spreadsheets, PDFs, CSVs, documents) or inline data — to parse, reconcile,
    verify numbers, transform data, or produce a data file (xlsx/csv/docx).
    The sandbox has NO network and cannot send anything. Available libraries:
    pandas, numpy, openpyxl, xlsxwriter, pypdf, python-docx, chardet, dateutil.
    CONTRACT: read inputs from /job/inputs/<filename> (read-only), write every
    output file to /job/out/, print your checks and findings to stdout. Use this
    instead of doing arithmetic or data transformation in your head — computed
    numbers are trustworthy, asserted ones are not.

    Args:
        script: The Python script (reads /job/inputs, writes /job/out, prints checks).
        description: One line — what this computation does.
        file_ids: Knowledge-base file ids to mount as inputs (from search_knowledge_base results).
        data: Small inline text/CSV data — mounted at /job/inputs/data.txt.
        timeout_s: Wall-clock budget in seconds (default 60, max 120).
    """
    config: dict = {"script": script}
    if description:
        config["description"] = description
    if file_ids:
        config["file_ids"] = file_ids
    if data:
        config["data"] = data
    if timeout_s:
        config["timeout_s"] = timeout_s
    return _call("run_compute", run_context, config)


@tool
def find_team_work(run_context: RunContext, query: str = "", coworker: str = "", limit: int = 10) -> str:
    """Find a teammate's recent work — documents/outputs other coworkers produced.
    Use this to build on a colleague's output (e.g. find Max's research) instead of
    asking the user to fetch it. Then read_team_work to read one.

    Args:
        query: Topic or keywords to match in titles (optional).
        coworker: Limit to one coworker by name, e.g. "Max" (optional).
        limit: Max results (default 10).
    """
    config: dict = {}
    if query:
        config["query"] = query
    if coworker:
        config["coworker"] = coworker
    if limit:
        config["limit"] = limit
    return _call("find_team_work", run_context, config)


@tool
def read_team_work(run_context: RunContext, id: str) -> str:
    """Read the full content of a teammate's document by its id (from find_team_work),
    so you can build on it.

    Args:
        id: The document id from find_team_work.
    """
    return _call("read_team_work", run_context, {"id": id})


# Data + web tools — assigned to every worker (matches all_tools in native loop).
DATA_TOOLS = [
    get_emails, get_meeting_context, check_calendar, prepare_event_action, search_knowledge_base,
    web_search, fetch_url, deep_research, generate_document,
    run_compute, find_team_work, read_team_work,
]
