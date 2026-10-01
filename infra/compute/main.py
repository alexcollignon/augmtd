"""
THE COMPUTE SANDBOX (Arc 1 of docs/one-surface-plan.md — the deliverable ceiling).

A model writes a script; THIS service is the locked room where it runs. The contract:

  POST /run   (Authorization: Bearer $COMPUTE_SECRET)
    { "job_id": "…", "script": "<python source>",
      "files": [{"name": "data.xlsx", "url": "<signed url>"}], "timeout_s": 120 }
  → synchronous → { "ok": true|false, "outputs": [{"name","b64","mime"}],
                    "stdout": "…", "stderr": "…", "duration_ms": 1234 }

THE SANDBOX LAWS (structural, not promissory):
  • The job container runs with --network none — a script can NEVER phone home, exfiltrate,
    or send anything. Sends stay a Vercel-side commit-door monopoly.
  • Inputs are DECLARED (the manifest) and mounted READ-ONLY at /job/inputs. The service
    downloads them (it has network; the job does not) — the manifest IS the observation log.
  • Hard caps: input ≤ 100 MB total · output ≤ 20 MB / 10 files · CPU 1 · mem 1 GB ·
    pids 256 · wall-clock ≤ 120 s. Exceeding any cap is an honest failure, never a hang.
  • No secrets ever enter the job environment.

Deploy: see infra/compute/README.md (the manual docker sequence — same ContainerConfig
caveat as the meeting bot).
"""
import asyncio
import base64
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile

import httpx
from fastapi import FastAPI, HTTPException, Request

# W38: the slim image has no /etc/mime.types, so mimetypes knows no Office types and every
# .xlsx/.docx/.pptx output was returned as application/octet-stream. Registered explicitly (the
# TS caller also corrects by extension — lib/tools/compute.ts outputMime — so either side suffices).
for _ext, _mime in {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".xls": "application/vnd.ms-excel",
    ".doc": "application/msword",
    ".ppt": "application/vnd.ms-powerpoint",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".md": "text/markdown",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".zip": "application/zip",
}.items():
    mimetypes.add_type(_mime, _ext)
from pydantic import BaseModel, Field

COMPUTE_SECRET = os.environ.get("COMPUTE_SECRET", "")
RUNNER_IMAGE = os.environ.get("COMPUTE_RUNNER_IMAGE", "augmtd_compute-runner:latest")
# The service's own scratch dir is bind-mounted into job containers; when the service itself
# runs in Docker this must be a HOST path both sides can see (compose mounts /root/compute-jobs).
JOBS_DIR = os.environ.get("COMPUTE_JOBS_DIR", "/data/jobs")

MAX_INPUT_BYTES = 100 * 1024 * 1024
MAX_OUTPUT_BYTES = 20 * 1024 * 1024
MAX_OUTPUT_FILES = 10
MAX_TIMEOUT_S = 120
MAX_SCRIPT_CHARS = 200_000
STDOUT_TAIL = 20_000
# THE FORMULA RECALC STEP (Oct 1): an .xlsx output with formulas is re-saved by LibreOffice inside
# the locked room so it carries computed values (openpyxl caches none, xlsxwriter caches 0 — previews
# showed blanks/zeros). recalc_xlsx.py ships with this service and is mounted read-only into a second,
# short job. It must finish inside the CALLER's budget: lib/tools/compute.ts aborts at timeout_s+30s.
RECALC_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recalc_xlsx.py")
RECALC_MAX_S = 60
RECALC_MIN_S = 12
CALLER_GRACE_S = 25

app = FastAPI(title="augmtd-compute", docs_url=None, redoc_url=None)


class JobFile(BaseModel):
    name: str = Field(max_length=200)
    # Exactly one of: a signed URL the service downloads, or small inline content.
    url: str | None = None
    content_b64: str | None = Field(default=None, max_length=8 * 1024 * 1024)


class JobRequest(BaseModel):
    job_id: str = Field(default_factory=lambda: uuid.uuid4().hex, max_length=64)
    script: str = Field(max_length=MAX_SCRIPT_CHARS)
    files: list[JobFile] = Field(default_factory=list, max_length=20)
    timeout_s: int = Field(default=MAX_TIMEOUT_S, ge=5, le=MAX_TIMEOUT_S)


def _auth(request: Request) -> None:
    if not COMPUTE_SECRET:
        raise HTTPException(503, "service not configured")
    if request.headers.get("authorization") != f"Bearer {COMPUTE_SECRET}":
        raise HTTPException(401, "unauthorized")


def _safe_name(name: str) -> str:
    """Flatten any path tricks — an input/output name is a bare filename, never a path."""
    base = os.path.basename(name).replace("..", "_").strip() or "file"
    return base[:200]


async def _download_inputs(files: list[JobFile], inputs_dir: str) -> None:
    total = 0
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        for f in files:
            dest = os.path.join(inputs_dir, _safe_name(f.name))
            if f.content_b64 is not None:
                raw = base64.b64decode(f.content_b64)
                total += len(raw)
                if total > MAX_INPUT_BYTES:
                    raise HTTPException(413, "inputs exceed the 100MB cap")
                with open(dest, "wb") as out:
                    out.write(raw)
                continue
            if not f.url:
                raise HTTPException(422, f"input '{f.name}' has neither url nor content")
            async with client.stream("GET", f.url) as res:
                if res.status_code != 200:
                    raise HTTPException(422, f"input '{f.name}' download failed ({res.status_code})")
                with open(dest, "wb") as out:
                    async for chunk in res.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_INPUT_BYTES:
                            raise HTTPException(413, "inputs exceed the 100MB cap")
                        out.write(chunk)


def _tail(v: object) -> str:
    s = v.decode(errors="replace") if isinstance(v, bytes) else (v or "")
    return str(s)[-STDOUT_TAIL:]


def _run_container(job_id: str, job_dir: str, timeout_s: int, command: list[str] | None = None,
                   extra_mounts: list[str] | None = None) -> tuple[int, str, str]:
    """The locked room: no network, read-only inputs, bounded cpu/mem/pids/time."""
    container = f"compute-{_safe_name(job_id)}"
    mounts: list[str] = []
    for m in extra_mounts or []:
        mounts += ["-v", m]
    cmd = [
        "docker", "run", "--rm", "--name", container,
        "--network", "none",
        "--memory", "1g", "--cpus", "1", "--pids-limit", "256",
        "--read-only", "--tmpfs", "/tmp:size=256m",
        "--security-opt", "no-new-privileges",
        "-v", f"{job_dir}/inputs:/job/inputs:ro",
        "-v", f"{job_dir}/out:/job/out:rw",
        "-v", f"{job_dir}/script.py:/job/script.py:ro",
        *mounts,
        "-w", "/job",
        RUNNER_IMAGE,
        *(command or ["python", "/job/script.py"]),
    ]
    try:
        # +10s grace so docker's own startup overhead never eats the script's budget.
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s + 10)
        return proc.returncode, _tail(proc.stdout), _tail(proc.stderr)
    except subprocess.TimeoutExpired as e:
        # A timed-out container must not linger.
        subprocess.run(["docker", "kill", container], capture_output=True)
        return 124, _tail(e.stdout), "wall-clock timeout"


def _xlsx_with_formulas(out_dir: str) -> list[str]:
    """Output workbooks that contain at least one formula cell (zip scan, stdlib only)."""
    found: list[str] = []
    for name in sorted(os.listdir(out_dir))[:MAX_OUTPUT_FILES]:
        path = os.path.join(out_dir, name)
        if not (name.lower().endswith(".xlsx") and os.path.isfile(path)):
            continue
        try:
            with zipfile.ZipFile(path) as z:
                for member in z.namelist():
                    if member.startswith("xl/worksheets/") and member.endswith(".xml"):
                        xml = z.read(member)
                        if b"<f>" in xml or b"<f " in xml:
                            found.append(name)
                            break
        except Exception:
            continue  # not a readable zip — leave it exactly as the script wrote it
    return found


def _recalc_xlsx(job_id: str, job_dir: str, names: list[str], budget_s: int) -> str:
    """Second short job: LibreOffice recalculates + re-saves each workbook in place. Never fatal —
    returns a log line for stderr; on any failure the script's original files stand."""
    if not names:
        return ""
    if budget_s < RECALC_MIN_S or not os.path.exists(RECALC_SCRIPT):
        return f"[recalc] skipped ({'no time left' if budget_s < RECALC_MIN_S else 'helper missing'}): {', '.join(names)}"
    shutil.copyfile(RECALC_SCRIPT, os.path.join(job_dir, "recalc.py"))
    code, stdout, stderr = _run_container(
        f"{job_id}-recalc", job_dir, budget_s,
        command=["python", "/job/recalc.py", *[f"/job/out/{n}" for n in names]],
        extra_mounts=[f"{job_dir}/recalc.py:/job/recalc.py:ro"],
    )
    return f"[recalc] exit={code} {stdout.strip()} {stderr.strip()[-300:] if code else ''}".strip()


def _collect_outputs(out_dir: str) -> list[dict]:
    outputs: list[dict] = []
    total = 0
    entries = sorted(os.listdir(out_dir))[:MAX_OUTPUT_FILES]
    for name in entries:
        path = os.path.join(out_dir, name)
        if not os.path.isfile(path):
            continue
        size = os.path.getsize(path)
        total += size
        if total > MAX_OUTPUT_BYTES:
            raise HTTPException(413, "outputs exceed the 20MB cap")
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        outputs.append({"name": _safe_name(name), "b64": b64, "mime": mime, "size": size})
    return outputs


@app.get("/health")
async def health():
    return {"status": "ok", "runner": RUNNER_IMAGE}


@app.post("/run")
async def run_job(req: JobRequest, request: Request):
    _auth(request)
    started = time.monotonic()
    job_dir = os.path.join(JOBS_DIR, _safe_name(req.job_id) or uuid.uuid4().hex)
    inputs_dir, out_dir = os.path.join(job_dir, "inputs"), os.path.join(job_dir, "out")
    os.makedirs(inputs_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    # The job runs as uid 10001 (non-root) while this service creates the dirs as root —
    # /job/out must be writable by the job (found live: PermissionError on first deploy).
    os.chmod(out_dir, 0o777)
    try:
        with open(os.path.join(job_dir, "script.py"), "w") as fh:
            fh.write(req.script)
        await _download_inputs(req.files, inputs_dir)
        code, stdout, stderr = await asyncio.to_thread(_run_container, req.job_id, job_dir, req.timeout_s)
        recalc_log = ""
        if code == 0:
            # Re-runs in a fresh locked room, so it can never see more than the script produced.
            deadline_left = req.timeout_s + CALLER_GRACE_S - (time.monotonic() - started)
            recalc_log = await asyncio.to_thread(
                _recalc_xlsx, req.job_id, job_dir, _xlsx_with_formulas(out_dir),
                int(min(RECALC_MAX_S, deadline_left - 10)),  # -10: _run_container's docker grace
            )
        outputs = _collect_outputs(out_dir) if code == 0 else []
        return {
            "ok": code == 0,
            "exit_code": code,
            "outputs": outputs,
            "stdout": stdout,
            "stderr": stderr,
            "recalc": recalc_log,  # the formula-recalc step's report (empty when no workbook had formulas)
            "duration_ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)
