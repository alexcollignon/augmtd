# augmtd-compute — the sandbox job service (Arc 1, docs/one-surface-plan.md)

Runs model-written scripts in a locked room: `--network none`, read-only declared inputs,
cpu/mem/pids/wall-clock caps, non-root, outputs capped and returned inline. The service has
network (it downloads the declared inputs); the job never does. Sends remain impossible here —
the commit door on Vercel keeps its monopoly.

## Contract

```
POST /run   Authorization: Bearer $COMPUTE_SECRET
{ "job_id": "…", "script": "<python>", "files": [{"name":"data.xlsx","url":"<signed url>"}], "timeout_s": 120 }
→ { "ok": bool, "exit_code": int, "outputs": [{"name","b64","mime","size"}], "stdout", "stderr", "duration_ms" }
```

Script contract (what the TS tool tells the model): inputs at `/job/inputs/<name>` (read-only),
write every deliverable to `/job/out/`, print reasoning/checks to stdout. Python 3.12 with
pandas · numpy · openpyxl · xlsxwriter · pypdf · python-docx · chardet · dateutil. No network.

## Caps (enforced service-side, not promised)

input ≤ 100 MB total · outputs ≤ 20 MB / 10 files · mem 1 GB · 1 CPU · pids 256 ·
wall-clock ≤ 120 s (+10 s docker grace) · script ≤ 200k chars · stdout/stderr tail 20k.

## Deploy (Hetzner box — same manual sequence as the meeting bot; docker-compose v1.29 there
## has the ContainerConfig bug, use plain docker)

```bash
# 1. Copy the service files
scp -r infra/compute root@46.224.176.245:/root/augmtd-infra/infra/

# 2. Build BOTH images on the box
ssh root@46.224.176.245 "cd /root/augmtd-infra/infra/compute && \
  docker build -t augmtd_compute-runner:latest -f Dockerfile.runner . && \
  docker build -t augmtd_compute:latest -f Dockerfile ."

# 3. Run the service (jobs dir must be a HOST path — it is bind-mounted into job containers).
#    COMPUTE_SECRET: generate once (openssl rand -hex 32), mirror it in Vercel env.
#    Port 8002 is public + bearer-authed — the box's house pattern (meeting-bot :3001,
#    agentos :8001; the whisper lesson was an UNAUTHED port, not a raw one). Moving behind
#    Caddy (compute.augmtd.ai → 127.0.0.1:8002) is optional later hardening + TLS.
ssh root@46.224.176.245 "mkdir -p /root/compute-jobs && \
  docker stop augmtd_compute 2>/dev/null; docker rm augmtd_compute 2>/dev/null; \
  docker run -d --name augmtd_compute --restart unless-stopped \
    -p 8002:8002 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /root/compute-jobs:/root/compute-jobs \
    -e COMPUTE_JOBS_DIR=/root/compute-jobs \
    -e COMPUTE_SECRET=<the secret> \
    augmtd_compute:latest"

# 4. Verify (health + the full gate suite incl. the locked-room proof)
ssh root@46.224.176.245 "curl -s localhost:8002/health"
COMPUTE_SERVICE_URL=http://46.224.176.245:8002 COMPUTE_SECRET=<the secret> npx tsx scripts/smoke-compute.ts
```

DEPLOYED Aug 5, 2026 — gates 16/16 (incl. C5 live: end-to-end job + the network-refusal proof).
Two found-live fixes baked in: Debian trixie needs `docker-cli` (docker.io ships no binary), and
/job/out must be chmod'd for the non-root job (the service creates dirs as root).

Vercel env: `COMPUTE_SERVICE_URL=http://46.224.176.245:8002` · `COMPUTE_SECRET=<same secret>`
(local dev: both already in `.env.local`).

## Notes

- The service container mounts the docker socket (root-equivalent on the box) — the job
  containers it launches are the isolation boundary, not the service container.
- `COMPUTE_JOBS_DIR` must be the SAME host path inside and outside the service container
  (bind-mount identity) so the job container's `-v` mounts resolve.
- Job dirs are deleted after every run (success or failure) — nothing persists on the box.
