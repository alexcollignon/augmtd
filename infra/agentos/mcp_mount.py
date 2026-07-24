# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE MCP RAIL (projecthood Phase 5D) — mount self-hosted MCP servers as coworker tools.
#
# SOVEREIGNTY MODEL: MCP servers are CODE WE RUN on this box (docker siblings of AgentOS), never a
# hosted relay. They call the SaaS provider directly with tokens from OUR Nango. Nothing transits a
# third party. Each adopted server is security-reviewed, version-pinned, and scope-limited BEFORE it
# appears here (the runbook in README.md).
#
# MULTI-TENANCY (the honest constraint, discovered before deploying anything): AgentOS is ONE process
# serving many users/companies, but ecosystem MCP servers take credentials at STARTUP — a static
# mount can only carry ONE tenant's token. Therefore:
#   • Servers mounted here must be TENANT-SAFE: either credential-free, or AUTH-SHIMMED — accepting
#     the acting user/company as a TOOL ARGUMENT and fetching the right token from Nango per call
#     (the same per-user pattern our HTTP tools already use via run_context).
#   • A raw ecosystem server that only supports startup credentials is NOT mountable multi-tenant —
#     wrap it or skip it. This is a review-checklist item, not a runtime surprise.
#
# CONFIG: env AGENTOS_MCP_SERVERS = JSON list, e.g.
#   [{"name": "gdrive", "transport": "streamable-http", "url": "http://127.0.0.1:8101/mcp"}]
# Unset/empty → no MCP tools, zero behavior change (the rollback switch, like WORKERS_USE_AGENTOS).
# Failures are logged and skipped — a bad server config can never take the workers down.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
import json
import os


def build_mcp_tools() -> list:
    """MCPTools instances for every configured server. [] when unconfigured (flag off)."""
    raw = os.environ.get("AGENTOS_MCP_SERVERS", "").strip()
    if not raw:
        return []
    try:
        servers = json.loads(raw)
        assert isinstance(servers, list)
    except Exception as e:  # noqa: BLE001 — config errors must not kill the service
        print(f"[mcp] AGENTOS_MCP_SERVERS unparseable — ignoring ({e})")
        return []

    tools = []
    for s in servers:
        try:
            from agno.tools.mcp import MCPTools  # import inside: agno[os] extra always has it, but stay defensive

            name = s.get("name", "mcp")
            transport = s.get("transport", "streamable-http")
            if transport in ("streamable-http", "sse"):
                tools.append(MCPTools(transport=transport, url=s["url"]))
            elif transport == "stdio":
                tools.append(MCPTools(command=s["command"]))
            else:
                print(f"[mcp] {name}: unknown transport '{transport}' — skipped")
                continue
            print(f"[mcp] mounted '{name}' ({transport})")
        except Exception as e:  # noqa: BLE001
            print(f"[mcp] failed to mount {s.get('name', '?')} — skipped ({e})")
    return tools
