"""
Privacy-preserving model factory for AgentOS.

This is the Python mirror of the `bedrock_optimised` tier in lib/ai/defaults.ts.
It deliberately constructs ONLY ONE kind of client:

  - AWS Bedrock (Claude, EU region) — every task

It NEVER builds a direct OpenAI or Anthropic-public client, and (since Aug 19)
no third-party OSS host either. That is the structural privacy guarantee:
prompts can only ever reach AWS Bedrock eu-central-1 (where Anthropic has no
access to the data). No code path here can send data outside that perimeter.

Task → model mapping matches lib/ai/defaults.ts `bedrock_optimised`:
  conversation   → Bedrock Sonnet (EU)
  planning       → Bedrock Sonnet (EU)
  generation     → Bedrock Haiku  (EU)
  ocr            → Bedrock Haiku  (EU)
  summarization  → Bedrock Haiku  (EU)
  classification → Bedrock Haiku  (EU)
  assignment     → Bedrock Haiku  (EU)
(The workers only ever request "conversation" today.)
"""

from __future__ import annotations

import os

from agno.models.aws import Claude as BedrockClaude


def _env(name: str, default: str | None = None) -> str | None:
    """Read an env var, stripping surrounding whitespace.

    Critical for credentials: Docker's --env-file (unlike python-dotenv) does
    NOT strip trailing whitespace, and a single trailing space on an AWS access
    key corrupts the SigV4 Authorization header → 403. Strip defensively so no
    env delivery mechanism can break auth.
    """
    v = os.getenv(name, default)
    return v.strip() if isinstance(v, str) else v

# ─── Model IDs ────────────────────────────────────────────────────────────────
# Kept as env-overridable constants so a model bump is a one-line change and
# matches lib/ai/defaults.ts exactly. NOTE: defaults.ts currently pins the
# Bedrock conversation model to claude-sonnet-4-5-20250929; MEMORY.md (Phase 191)
# references an upgrade to sonnet-4-6. We default to the value in defaults.ts and
# expose an env override so the two stay reconcilable.
BEDROCK_SONNET = _env(
    "AGENTOS_BEDROCK_SONNET", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
)
BEDROCK_HAIKU = _env(
    "AGENTOS_BEDROCK_HAIKU", "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
)
# Bedrock credentials — same env var names as lib/ai/factory.ts.
AWS_BEDROCK_REGION = _env("AWS_BEDROCK_REGION", "eu-central-1")
AWS_BEDROCK_ACCESS_KEY = _env("AWS_BEDROCK_ACCESS_KEY")
AWS_BEDROCK_SECRET_KEY = _env("AWS_BEDROCK_SECRET_KEY")


def _bedrock(model_id: str, max_tokens: int):
    return BedrockClaude(
        id=model_id,
        aws_region=AWS_BEDROCK_REGION,
        aws_access_key=AWS_BEDROCK_ACCESS_KEY,
        aws_secret_key=AWS_BEDROCK_SECRET_KEY,
        max_tokens=max_tokens,
    )


def model_for_task(task: str):
    """Return an Agno model instance for the given task type.

    Mirrors the `bedrock_optimised` tier. Defaults to the conversation model
    for unknown task types (safest interactive choice).
    """
    if task in ("conversation", "planning"):
        return _bedrock(BEDROCK_SONNET, 8192)
    if task in ("generation", "ocr", "summarization", "classification", "assignment"):
        return _bedrock(BEDROCK_HAIKU, 4096)
    # Default: interactive conversation model.
    return _bedrock(BEDROCK_SONNET, 8192)


def assert_private_credentials() -> list[str]:
    """Verify the private providers are configured. Returns a list of warnings.

    Does NOT fail on the presence of public-provider keys — the Hetzner .env is
    shared with other services — because privacy here is structural: this module
    only ever builds Bedrock clients. This check just makes sure the private
    provider we DO use is actually configured.
    """
    warnings: list[str] = []
    if not (AWS_BEDROCK_ACCESS_KEY and AWS_BEDROCK_SECRET_KEY):
        warnings.append(
            "AWS_BEDROCK_ACCESS_KEY / AWS_BEDROCK_SECRET_KEY not set — "
            "Bedrock calls will fail."
        )
    return warnings
