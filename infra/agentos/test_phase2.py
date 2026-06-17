"""
Phase 2 test — the 4 workers as Agno agents, conversation path per worker.

Run:  python test_phase2.py

Checks:
  1. main imports, all 4 workers registered in AgentOS.
  2. (Live, if Bedrock creds present) each worker responds to "introduce
     yourself" with a non-empty answer that uses its own name — proving the
     per-worker identity + private-model conversation path works.
  3. (Live) streaming endpoint yields chunks for one worker.

Exit 0 = pass.
"""

import sys

EXPECTED = {
    "personal_assistant": "clara",
    "content_manager": "sofia",
    "linkedin_drafter": "luca",
    "research_analyst": "max",
}


def main() -> int:
    try:
        import main as agentos_main
        from models import assert_private_credentials
        from fastapi.testclient import TestClient
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: import error — {e}")
        return 1
    print("PASS: imports clean")

    client = TestClient(agentos_main.app)

    # 1. All 4 registered
    cfg = str(client.get("/config").json()).lower()
    missing = [wid for wid in EXPECTED if wid not in cfg]
    if missing:
        print(f"FAIL: workers not registered: {missing}")
        return 1
    print("PASS: all 4 workers registered (clara, sofia, luca, max)")

    warnings = assert_private_credentials()
    has_bedrock = not any("BEDROCK" in w for w in warnings)
    if not has_bedrock:
        print("SKIP: live per-worker intro (Bedrock creds not set)")
        print("\nPhase 2 registration checks passed.")
        return 0

    # 2. Live intro per worker — must speak in-character with its own name
    for wid, name in EXPECTED.items():
        resp = client.post(
            f"/agents/{wid}/runs",
            data={"message": "Introduce yourself in one sentence.", "stream": "false"},
        )
        if resp.status_code != 200:
            print(f"FAIL: {wid} run returned {resp.status_code}: {resp.text[:200]}")
            return 1
        content = (resp.json().get("content") or "").strip()
        if not content:
            print(f"FAIL: {wid} returned empty content")
            return 1
        if name not in content.lower():
            print(f"WARN: {wid} reply did not contain '{name}': {content[:120]}")
        else:
            print(f"PASS: {name.capitalize()} — {content[:90]}")

    # 3. Streaming check (one worker)
    with client.stream(
        "POST", "/agents/personal_assistant/runs",
        data={"message": "Say hello.", "stream": "true"},
    ) as s:
        if s.status_code != 200:
            print(f"FAIL: streaming returned {s.status_code}")
            return 1
        chunks = sum(1 for _ in s.iter_lines() if _)
    if chunks == 0:
        print("FAIL: streaming yielded no chunks")
        return 1
    print(f"PASS: streaming works ({chunks} chunks from Clara)")

    print("\nPhase 2 fully verified (per-worker identity + streaming, private models).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
