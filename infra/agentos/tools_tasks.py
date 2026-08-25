"""
Worker task tools (Phase 4) — thin HTTP wrappers over the Next.js internal API.

These do NOT reimplement task logic. They call POST {AUGMTD_INTERNAL_URL}
/api/internal/agentos/tasks with the shared AGENTOS_SECRET bearer, so the
intelligence (generateWorkflowConfig, RLS-aware executors) stays in TypeScript
— single source of truth. user_id and agent_id come from the run context the
bridge passes per run; the secret comes from the box env (never from the model).
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx
from agno.run import RunContext
from agno.tools import tool

INTERNAL_URL = os.getenv("AUGMTD_INTERNAL_URL", "").rstrip("/")
INTERNAL_SECRET = os.getenv("AGENTOS_SECRET", "")


def _structured(value: Any) -> Any:
    """A model sometimes hands a JSON *string* where a list/object is declared. The TS sanitisers
    (authorDoors / authorInputs / step_patch) silently ignore a string — which would drop the whole
    wish with no note. Parse it here so what the model meant is what the executor sees; an
    unparseable value rides through untouched and the executor's own refusal speaks."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:  # noqa: BLE001
            return value
    return value


def _call(action: str, run_context: RunContext, **args) -> str:
    """POST an action to the Next.js internal task API and return the result text."""
    if not INTERNAL_URL:
        return "Task service not configured (AUGMTD_INTERNAL_URL unset)."
    user_id = run_context.user_id
    deps = run_context.dependencies or {}
    agent_id = deps.get("agent_id")
    if not user_id:
        return "Cannot manage tasks: no user context for this run."

    payload = {"action": action, "user_id": user_id, "agent_id": agent_id, "args": args}
    try:
        resp = httpx.post(
            f"{INTERNAL_URL}/api/internal/agentos/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {INTERNAL_SECRET}"},
            timeout=60.0,
        )
        if resp.status_code != 200:
            return f"Task action failed ({resp.status_code})."
        return resp.json().get("result", "Done.")
    except Exception as e:  # noqa: BLE001
        return f"Task service unreachable: {e}"


@tool
def list_tasks(run_context: RunContext) -> str:
    """List this worker's scheduled tasks. Call when the user asks what's automated,
    scheduled, or running, or wants to manage existing automations."""
    return _call("list_tasks", run_context)


@tool
def create_task(
    run_context: RunContext,
    description: str,
    skill_names: Optional[str] = None,
    trigger_doors: Optional[list] = None,
    input_doc_names: Optional[list] = None,
    input_accept_material: Optional[bool] = None,
    daily_run_limit: Optional[int] = None,
) -> str:
    """DRAFT a scheduled automation task from a plain-language description — nothing
    runs until the user confirms on the review card that appears in the chat. Include
    sources, what to produce, and the schedule; the system builds the full multi-step
    pipeline for review. Tell the user the plan is ready for their confirm — NEVER say
    the task was created (creation happens only on their click).

    Args:
        description: What the task does and when, e.g. "Every Monday 8am, scan my
            inbox for client emails and write a brief."
        skill_names: Optional comma-separated skill names (see list_skills) to enforce
            on this task's output, e.g. "Exec summary, Brand tone". Omit to use your
            assigned skills automatically.
        trigger_doors: Optional. The EVENT DOORS — the ways this task can start besides its
            schedule. One entry per distinct way ("when applications arrive by email OR
            someone uploads a CV" = two doors). Each entry is a dict:
            {"source": "mail"|"file"|"meeting"|"workflow", "when": "...", "workflow_name":
            "...", "label": "...", "filters": [{"field","op","value"}]}. Sources: "mail" (an
            email arrives), "file" (a file lands in knowledge), "meeting" (a meeting is
            recorded), "workflow" (another workflow delivers). For mail/file/meeting give
            "when" — the condition in plain words, judged against each arriving event. For
            source "workflow" give "workflow_name" — the NAME of an existing task that should
            feed this one (never an id — the system resolves the name). Never put a schedule
            here (timing goes in the description; a task holds only one).
            "filters" are EXACT conditions checked in code before any judgement — cheaper and
            more predictable than "when", so PREFER them for anything structural the user
            states ("from careers@acme.test" → from_address is/domain_is; "subject mentions
            application" → subject contains). Fields by source — mail: from_address
            (is/domain_is), subject (contains) · file: filename (contains), ext (is) ·
            meeting: title (contains). op is "is" (exact match), "contains" (substring) or
            "domain_is" (the address's domain). All filters must pass (AND); they combine with
            "when", which should then carry only what is genuinely fuzzy. Never invent a field
            or a value the user didn't state.
        input_doc_names: Optional. The INPUTS TRAY — names of documents in the user's knowledge
            base this task should read as STANDING reference on every run (a policy, template,
            rubric, brand guide). Give the NAME as the user says it — never an id; the system
            resolves it and says so if it can't find one. Omit when nothing is pinned.
        input_accept_material: Optional. True when the work is done ON something handed over at
            run time ("when I upload a CV", "paste the transcript and…") — it opens a material
            box on Run-now. Standing reference documents go in input_doc_names instead.
        daily_run_limit: Optional. THE THROTTLE — how many EVENT RUNS a day this task may start
            (1–100; default 20). Set it only when the user states a pace ("at most 3 a day").
            Extra events queue — they wait for the next day, nothing is ever dropped.
            Out-of-range numbers are kept within 1–100 and said out loud.
    """
    args: dict = {"description": description}
    if skill_names:
        args["skill_names"] = skill_names
    if trigger_doors is not None:
        args["trigger_doors"] = _structured(trigger_doors)
    if input_doc_names is not None:
        args["input_doc_names"] = _structured(input_doc_names)
    if input_accept_material is not None:
        args["input_accept_material"] = input_accept_material
    if daily_run_limit is not None:
        args["daily_run_limit"] = daily_run_limit
    return _call("create_task", run_context, **args)


@tool
def get_task(run_context: RunContext, task_id: str) -> str:
    """Read the full config of one task (steps, schedule, language, instructions).
    Call before editing so you have current state.

    Args:
        task_id: Task ID (from list_tasks).
    """
    return _call("get_task", run_context, task_id=task_id)


@tool
def update_task(
    run_context: RunContext,
    task_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    status: Optional[str] = None,
    trigger: Optional[dict] = None,
    add_trigger_doors: Optional[list] = None,
    remove_trigger_doors: Optional[list] = None,
    add_input_docs: Optional[list] = None,
    remove_input_docs: Optional[list] = None,
    input_accept_material: Optional[bool] = None,
    daily_run_limit: Optional[int] = None,
    output_language: Optional[str] = None,
    output_destination: Optional[str] = None,
    output_artifact_type: Optional[str] = None,
    output_title: Optional[str] = None,
    output_slack_channel: Optional[str] = None,
    output_report_mode: Optional[str] = None,
    output_slack_announcement: Optional[str] = None,
    output_email_to: Optional[str] = None,
    output_email_as_attachment: Optional[bool] = None,
    output_email_body_instructions: Optional[str] = None,
    worker_instructions: Optional[str] = None,
    skill_names: Optional[str] = None,
    step_patch: Optional[dict] = None,
    steps: Optional[list] = None,
) -> str:
    """Edit any aspect of an existing task in response to user feedback. Call get_task first
    so you have the current state. Supports rename, schedule, event doors, the inputs tray,
    the daily event limit, output settings, task instructions, status, pinned skills, and
    single-step edits (step_patch — identify the right step from the labels and prompts you
    read). Act immediately — do not ask to confirm first.

    Args:
        task_id: Task to update.
        name: New name.
        description: New task description.
        status: "active" or "paused".
        trigger: New schedule — the full object, e.g. {"type": "schedule", "cron": "0 9 * * 1",
            "timezone": "Europe/Lisbon", "label": "Every Monday at 9am"}. "type" is "manual" or
            "schedule".
        add_trigger_doors: ADD event doors — the ways this task can start besides its schedule.
            ADDITIVE: doors already on the task are kept, so "also run it when a file lands"
            adds one door and touches nothing else. Same entry shape as create_task's
            trigger_doors: {"source": "mail"|"file"|"meeting"|"workflow", "when": "...",
            "workflow_name": "...", "label": "...", "filters": [{"field","op","value"}]}.
            Sources: "mail" (an email arrives), "file" (a file lands in knowledge), "meeting"
            (a meeting is recorded), "workflow" (another workflow delivers — give the NAME of
            an existing task, never an id). Filter fields by source — mail: from_address
            (is/domain_is), subject (contains) · file: filename (contains), ext (is) ·
            meeting: title (contains); op is "is", "contains" or "domain_is". Filters are exact
            and checked in code before any judgement — prefer them for anything structural the
            user states, and never invent a field or a value they didn't say. Never put a
            schedule here — use "trigger" for timing (a task holds only one schedule).
        remove_trigger_doors: REMOVE event doors. Each entry is either a source key ("mail",
            "file", "meeting", "workflow") — which removes every door of that kind — or text
            matching the door's condition or label as get_task shows it. Doors you don't name
            are kept.
        add_input_docs: ADD documents to the INPUTS TRAY — the standing reference this task
            reads on every run. ADDITIVE: documents already pinned are kept, so "also use the
            brand guide" pins one and touches nothing else. Give NAMES as the user says them
            (never ids); the system resolves them against their knowledge base and says so if
            it can't find one.
        remove_input_docs: REMOVE documents from the inputs tray. Each entry is text matching a
            pinned document name as get_task shows it. Documents you don't name are kept.
        input_accept_material: Whether the task accepts material handed over at run time (a CV,
            a transcript, a draft) — it opens a material box on Run-now. Standing reference
            documents go in add_input_docs instead.
        daily_run_limit: THE THROTTLE — how many EVENT RUNS a day this task may start (1–100;
            default 20). Use it when the user asks for a different pace ("keep it to 5 a day",
            "let it run more"). Extra events queue — they wait for the next day, nothing is
            ever dropped. Out-of-range numbers are kept within 1–100 and said out loud.
        output_language: BCP-47 code, e.g. "de", "pt", "fr".
        output_destination: The deliverable's single home — "message" (run thread),
            "document" (Documents/Drive), "slack" (a channel), or "email".
        output_artifact_type: Document type — only when output_destination is "document":
            "document", "spreadsheet", "presentation", "email" or "frame". frame = a live
            interactive dashboard that updates in place with every run (versions kept).
        output_title: Title template for a document. Use {{date}} for the run date, {{week_of}}
            for the week, e.g. "Executive Briefing — {{week_of}}".
        output_slack_channel: Slack channel (#name or id) — to post to when destination
            is slack, or (for a document) a channel to also drop a link in.
        output_report_mode: How proactively you report back — "each_run" (default),
            "digest", or "silent".
        output_slack_announcement: For a document that also posts to Slack — an
            instruction for how to announce it in the channel (you write the message
            from this + the document, e.g. "2-line summary, tag <@Rene>").
        output_email_to: When destination is email — comma-separated recipient
            address(es) to send the deliverable to (any address). Empty clears it (→ the user).
        output_email_as_attachment: When destination is email — True to send the
            deliverable as a Word-document attachment (kept in Documents + Drive) instead
            of as the email body.
        output_email_body_instructions: When emailing as an attachment — optional
            guidance for how to write the short email body.
        worker_instructions: Task-specific tone/persona overriding the worker default.
        skill_names: Comma-separated skill names (see list_skills) to enforce on this
            task's output. Empty string clears pinned skills (use your assigned skills).
        step_patch: Edit a SINGLE step by its id — safer than replacing the whole pipeline.
            Read the step ids from get_task, identify the right step from its label and prompt,
            then patch only what needs to change: {"step_id": "...", "label": "...", "prompt":
            "..." (ai/agent steps), "config": {...} (tool steps — merged into the existing
            config), "case_instruction": "...", "case_name": "..."}.
            For a "case" step: case_instruction is what identifies a case when it DIFFERS per
            event ("the job opening named in the application"); case_name is the ONE case every
            run files under, when the user named a specific opening/client/matter ("the
            Customer Service Representative opening"). Setting either one clears the other.
            For an "input" step (the station that stops the run and asks the USER for something
            only they have at run time): "ask" is what it asks for, in the user's own words;
            "accepts" is "text", "doc" or "both" (the default).
        steps: Full replacement steps array. Use only when restructuring the entire pipeline
            (adding/removing/reordering steps). For editing a single step, use step_patch.
    """
    args = {
        k: v for k, v in {
            "name": name, "description": description, "status": status,
            "trigger": _structured(trigger),
            "add_trigger_doors": _structured(add_trigger_doors),
            "remove_trigger_doors": _structured(remove_trigger_doors),
            "add_input_docs": _structured(add_input_docs),
            "remove_input_docs": _structured(remove_input_docs),
            "input_accept_material": input_accept_material,
            "daily_run_limit": daily_run_limit,
            "output_language": output_language,
            "output_destination": output_destination,
            "output_artifact_type": output_artifact_type,
            "output_title": output_title,
            "output_slack_channel": output_slack_channel,
            "output_report_mode": output_report_mode,
            "output_email_to": output_email_to,
            "output_email_as_attachment": output_email_as_attachment,
            "output_email_body_instructions": output_email_body_instructions,
            "output_slack_announcement": output_slack_announcement,
            "worker_instructions": worker_instructions,
            "skill_names": skill_names,
            "step_patch": _structured(step_patch),
            "steps": _structured(steps),
        }.items() if v is not None
    }
    return _call("update_task", run_context, task_id=task_id, **args)


@tool
def run_task(run_context: RunContext, task_id: str) -> str:
    """Trigger an immediate manual run of an existing task. Use list_tasks to find
    the ID first.

    Args:
        task_id: Task to run now.
    """
    deps = run_context.dependencies or {}
    return _call("run_task", run_context, task_id=task_id, thread_id=deps.get("thread_id"))


@tool
def supply_run_input(
    run_context: RunContext,
    run_id: Optional[str] = None,
    text: Optional[str] = None,
    kb_file_name: Optional[str] = None,
    pin: Optional[bool] = None,
) -> str:
    """Give a paused task run the material it stopped to ask for. A run can STOP and ask the
    user for something only they have; when they hand it over ("here are the numbers",
    "here's the JD"), pass it straight through and the run picks up where it stopped.

    An attached file lands in the user's Knowledge under its own filename — supply it by name
    with kb_file_name, never by re-typing its contents. Send text OR kb_file_name, not both.

    Args:
        run_id: The paused run to answer. Omit when the user didn't name one — the single
            waiting run is resolved, and if several wait you are told which, so you can ask.
        text: The material in the user's own words, unchanged (no summarising).
        kb_file_name: Name of a Knowledge document to hand over instead.
        pin: True only when the user says the document should be read by EVERY future run.
    """
    args = {
        k: v for k, v in {
            "run_id": run_id,
            "text": text,
            "kb_file_name": kb_file_name,
            "pin": pin,
        }.items() if v is not None
    }
    return _call("supply_run_input", run_context, **args)


@tool
def duplicate_task(run_context: RunContext, task_id: str, name: Optional[str] = None) -> str:
    """Duplicate an existing task (paused copy, "Copy of" prefix). Use for variants
    — same pipeline, different language/audience/schedule.

    Args:
        task_id: Task to duplicate.
        name: Optional name for the copy.
    """
    args = {"name": name} if name else {}
    return _call("duplicate_task", run_context, task_id=task_id, **args)


@tool
def share_task(run_context: RunContext, task_id: str, action: str = "share") -> str:
    """Share one of your tasks with the team, or stop sharing it.

    Args:
        task_id: Task to share/unshare.
        action: "share" to make it team-visible, "unshare" to make it private.
    """
    return _call("share_task", run_context, task_id=task_id, action=action)


@tool
def list_team_tasks(run_context: RunContext) -> str:
    """List tasks shared by teammates that you can copy to your own list."""
    return _call("list_team_tasks", run_context)


@tool
def use_task(run_context: RunContext, task_id: str) -> str:
    """Copy a shared team task to your own task list (paused). Call after
    list_team_tasks to get the ID.

    Args:
        task_id: Shared team task to copy.
    """
    return _call("use_task", run_context, task_id=task_id)


@tool
def delete_task(run_context: RunContext, task_id: str) -> str:
    """Permanently delete a task. Only when the user explicitly asks. Confirm the
    task name first — this is irreversible.

    Args:
        task_id: Task to delete.
    """
    return _call("delete_task", run_context, task_id=task_id)


@tool
def list_worker_documents(run_context: RunContext) -> str:
    """List documents/reports this worker has produced from its tasks. Returns
    artifact IDs for get_worker_document."""
    return _call("list_worker_documents", run_context)


@tool
def get_worker_document(run_context: RunContext, artifact_id: str) -> str:
    """Retrieve the full content of a document this worker produced.

    Args:
        artifact_id: From list_worker_documents.
    """
    return _call("get_worker_document", run_context, artifact_id=artifact_id)


@tool
def list_skills(run_context: RunContext) -> str:
    """List the user's whole skill library. A skill is a reusable set of
    instructions for how to handle a kind of work — a method, process, format,
    structure, or style. Shows which skills are assigned to you (applied
    automatically) and which are available to pull on demand. Call when the user
    asks what skills exist, or before applying one you're unsure is assigned."""
    return _call("list_skills", run_context)


@tool
def apply_skill(run_context: RunContext, skill_name: str) -> str:
    """Pull a skill's full instructions from the user's library by name and apply
    them to the current task — use when the user asks you to follow a particular
    approach, method, format, or named skill that isn't already assigned to you.
    Assigned skills apply automatically and don't need this. After calling, follow
    the returned instructions precisely.

    Args:
        skill_name: Name of the skill. Use list_skills if unsure of the exact name.
    """
    return _call("apply_skill", run_context, skill_name=skill_name)


# All task tools — assigned to every worker (matches the native chat loop).
TASK_TOOLS = [
    list_tasks, create_task, get_task, update_task, run_task, supply_run_input, duplicate_task,
    share_task, list_team_tasks, use_task, delete_task,
    list_worker_documents, get_worker_document,
    list_skills, apply_skill,
]
