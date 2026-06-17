"""
Privacy-preserving model factory for AgentOS.

This is the Python mirror of the `bedrock_optimised` tier in lib/ai/defaults.ts.
It deliberately constructs ONLY two kinds of clients:

  - AWS Bedrock (Claude, EU region)  — interactive / user-facing tasks
  - Together AI (OpenAI-compatible)  — background tasks

It NEVER builds a direct OpenAI or Anthropic-public client. That is the
structural privacy guarantee: prompts can only ever reach AWS Bedrock (where
Anthropic has no access to the data) or Together AI (AUGMTD-managed infra).
No code path here can send data to api.openai.com or api.anthropic.com.

Task → model mapping matches lib/ai/defaults.ts `bedrock_optimised`:
  conversation   → Bedrock Sonnet (EU)
  generation     → Bedrock Haiku  (EU)
  ocr            → Bedrock Haiku  (EU)
  planning       → Together Kimi K2.6
  summarization  → Together gpt-oss-120b
  classification → Together gpt-oss-120b
  assignment     → Together gpt-oss-120b
"""

from __future__ import annotations

import os

from agno.models.aws import Claude as BedrockClaude
from agno.models.together import Together


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
TOGETHER_KIMI = _env("AGENTOS_TOGETHER_KIMI", "moonshotai/Kimi-K2.6")
TOGETHER_GPT_OSS = _env("AGENTOS_TOGETHER_GPT_OSS", "openai/gpt-oss-120b")

TOGETHER_BASE_URL = "https://api.together.xyz/v1"

# Bedrock credentials — same env var names as lib/ai/factory.ts.
AWS_BEDROCK_REGION = _env("AWS_BEDROCK_REGION", "eu-central-1")
AWS_BEDROCK_ACCESS_KEY = _env("AWS_BEDROCK_ACCESS_KEY")
AWS_BEDROCK_SECRET_KEY = _env("AWS_BEDROCK_SECRET_KEY")

# Together key — same fallback chain as lib/ai/factory.ts (AUGMTD_AI_KEY first).
TOGETHER_API_KEY = _env("AUGMTD_AI_KEY") or _env("TOGETHER_API_KEY")


def _bedrock(model_id: str, max_tokens: int):
    return BedrockClaude(
        id=model_id,
        aws_region=AWS_BEDROCK_REGION,
        aws_access_key=AWS_BEDROCK_ACCESS_KEY,
        aws_secret_key=AWS_BEDROCK_SECRET_KEY,
        max_tokens=max_tokens,
    )


def _together(model_id: str):
    return Together(
        id=model_id,
        api_key=TOGETHER_API_KEY,
        base_url=TOGETHER_BASE_URL,
    )


def model_for_task(task: str):
    """Return an Agno model instance for the given task type.

    Mirrors the `bedrock_optimised` tier. Defaults to the conversation model
    for unknown task types (safest interactive choice).
    """
    if task in ("conversation",):
        return _bedrock(BEDROCK_SONNET, 8192)
    if task in ("generation", "ocr"):
        return _bedrock(BEDROCK_HAIKU, 4096)
    if task in ("planning",):
        return _together(TOGETHER_KIMI)
    if task in ("summarization", "classification", "assignment"):
        return _together(TOGETHER_GPT_OSS)
    # Default: interactive conversation model.
    return _bedrock(BEDROCK_SONNET, 8192)


def assert_private_credentials() -> list[str]:
    """Verify the private providers are configured. Returns a list of warnings.

    Does NOT fail on the presence of public-provider keys — the Hetzner .env is
    shared with other services — because privacy here is structural: this module
    only ever builds Bedrock + Together clients. This check just makes sure the
    private providers we DO use are actually configured.
    """
    warnings: list[str] = []
    if not (AWS_BEDROCK_ACCESS_KEY and AWS_BEDROCK_SECRET_KEY):
        warnings.append(
            "AWS_BEDROCK_ACCESS_KEY / AWS_BEDROCK_SECRET_KEY not set — "
            "Bedrock (conversation/generation) calls will fail."
        )
    if not TOGETHER_API_KEY:
        warnings.append(
            "AUGMTD_AI_KEY / TOGETHER_API_KEY not set — "
            "Together (background tasks) calls will fail."
        )
    return warnings
