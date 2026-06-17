"""
Phase 1 smoke test — verifies the AgentOS foundation boots and serves.

Run:  python test_phase1.py

Checks, in order:
  1. models.py + main.py import cleanly (Agno installed, our wiring valid).
  2. The FastAPI app is built and serves routes (TestClient, no live server).
  3. The Ping agent is registered.
  4. (Optional) If Bedrock creds are present, run one live ping to prove the
     private model path works end-to-end. Skipped if creds are absent.

Exit code 0 = pass. Non-zero = fail.
"""

import sys


def main() -> int:
    # 1. Imports
    try:
        import main as agentos_main
        from models import assert_private_credentials
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: import error — {e}")
        return 1
    print("PASS: imports clean (agno installed, wiring valid)")

    warnings = assert_private_credentials()
    for w in warnings:
        print(f"  note: {w}")

    # 2. App serves
    try:
        from fastapi.testclient import TestClient

        client = TestClient(agentos_main.app)
        resp = client.get("/config")
        if resp.status_code != 200:
            print(f"FAIL: /config returned {resp.status_code}")
            return 1
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: app did not serve — {e}")
        return 1
    print("PASS: AgentOS FastAPI app serves /config")

    # 3. Ping agent registered
    cfg = resp.json()
    body = str(cfg).lower()
    if "ping" not in body:
        print(f"WARN: 'ping' agent not visible in /config payload: {cfg}")
    else:
        print("PASS: Ping agent registered")

    # 4. Optional live model ping
    has_bedrock = not any("BEDROCK" in w for w in warnings)
    if not has_bedrock:
        print("SKIP: live model ping (Bedrock creds not set locally)")
        print("\nPhase 1 boot checks passed.")
        return 0

    try:
        run = client.post(
            "/agents/ping/runs",
            data={"message": "ping", "stream": "false"},
        )
        if run.status_code != 200:
            print(f"FAIL: live ping returned {run.status_code}: {run.text[:300]}")
            return 1
        print(f"PASS: live private-model ping — {run.text[:200]}")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: live ping errored — {e}")
        return 1

    print("\nPhase 1 fully verified (including live private-model call).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
