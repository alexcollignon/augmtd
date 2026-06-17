"""
Worker task tools (Phase 4) — thin HTTP wrappers over the Next.js internal API.

These do NOT reimplement task logic. They call POST {AUGMTD_INTERNAL_URL}
/api/internal/agentos/tasks with the shared AGENTOS_SECRET bearer, so the
intelligence (generateWorkflowConfig, RLS-aware executors) stays in TypeScript
— single source of truth. user_id and agent_id come from the run context the
bridge passes per run; the secret comes from the box env (never from the model).
"""

from __future__ import annotations

import os
from typing import Optional

import httpx
from agno.run import RunContext
from agno.tools import tool

INTERNAL_URL = os.getenv("AUGMTD_INTERNAL_URL", "").rstrip("/")
INTERNAL_SECRET = os.getenv("AGENTOS_SECRET", "")


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
def create_task(run_context: RunContext, description: str) -> str:
    """Create a new scheduled automation task from a plain-language description.
    Include sources, what to produce, and the schedule. The system builds the full
    multi-step pipeline automatically.

    Args:
        description: What the task does and when, e.g. "Every Monday 8am, scan my
            inbox for client emails and write a brief."
    """
    return _call("create_task", run_context, description=description)


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
    status: Optional[str] = None,
    output_language: Optional[str] = None,
    worker_instructions: Optional[str] = None,
) -> str:
    """Edit an existing task in response to user feedback. Call get_task first.
    Supports rename, pause/resume (status active|paused), output language, and
    task-specific instructions. Act immediately — do not ask to confirm first.

    Args:
        task_id: Task to update.
        name: New name.
        status: "active" or "paused".
        output_language: BCP-47 code, e.g. "de", "pt", "fr".
        worker_instructions: Task-specific tone/persona overriding the worker default.
    """
    args = {
        k: v for k, v in {
            "name": name, "status": status,
            "output_language": output_language,
            "worker_instructions": worker_instructions,
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


# All task tools — assigned to every worker (matches the native chat loop).
TASK_TOOLS = [
    list_tasks, create_task, get_task, update_task, run_task, duplicate_task,
    share_task, list_team_tasks, use_task, delete_task,
    list_worker_documents, get_worker_document,
]
