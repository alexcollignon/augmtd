# augmtd — Technical & Security Overview

**Document type:** Technical and Data Processing Information Sheet  
**Version:** 1.2 — June 2026  
**Prepared by:** Alexandre Collignon, augmtd  
**Contact:** alex@augmtd.ai  

---

## 1. About augmtd

augmtd is an AI productivity platform designed for professional organisations. It connects to communication tools (email, calendar), meeting systems, and document repositories to help teams automate recurring knowledge work — intelligence briefs, research pipelines, content drafting — using AI.

The platform is built around a **modular feature architecture**. Organisations activate only the modules relevant to their use case. Each module can be independently enabled or disabled by the administrator. No module processes data beyond its stated purpose.

augmtd is incorporated and operated from Portugal. All infrastructure is hosted within the European Union.

---

## 2. Pilot Scope — Chamber of Commerce

The current pilot activates **two workflow modules only**:

| Workflow | Description | Data sources |
|---|---|---|
| **Executive Briefing** | Weekly AI-synthesised intelligence digest covering German and Portuguese business, trade, and regulatory news | Public RSS feeds, publicly accessible web pages |
| **LinkedIn Post Drafter** | AI-generated social content based on the week's intelligence | Output of the Executive Briefing workflow |

**Neither workflow reads from, writes to, or interacts with the connected Microsoft account's mailbox or calendar in any way.** Both are fully automated data pipelines that ingest public information and produce structured outputs, delivered within the augmtd platform.

A third workflow — a member newsletter — is scoped for a future phase and is not active during this pilot.

---

## 3. Platform Architecture

augmtd is a web application with the following layers:

```
┌─────────────────────────────────────────────┐
│    augmtd Application (Next.js, Vercel EU)   │
│   Web UI and API routes — single deployment  │
├────────────────┬────────────────────────────┤
│  Database &    │     AI Processing           │
│  File Storage  │  AWS Bedrock (Frankfurt)    │
│  (Supabase EU) │  + Hetzner (audio/Whisper)  │
├────────────────┴────────────────────────────┤
│     External Connections (OAuth-based)       │
│      Microsoft 365 · Google Workspace        │
└─────────────────────────────────────────────┘
```

**Tenant isolation:** Every organisation's data is fully isolated at the database level using row-level security (RLS) policies enforced by the database engine itself, not application logic. No organisation can access another's data, even in the event of an application-level error.

**Authentication:** User authentication is handled by Supabase Auth (industry-standard JWT-based sessions). OAuth tokens for connected accounts are stored in the database and are never exposed to the frontend.

---

## 4. Microsoft OAuth Scopes — Justification

When connecting a Microsoft 365 account, augmtd requests the following OAuth permission scopes:

| Scope | Purpose in augmtd | Active in pilot? |
|---|---|---|
| `Mail.ReadWrite` | Read incoming emails to process them into AI work items; move, archive, or label emails on the user's behalf | **No** |
| `Mail.Send` | Send AI-drafted replies or deliver workflow outputs to the user's inbox | **No** |
| `Calendars.ReadWrite` | Read upcoming meetings to provide AI with scheduling context; write is reserved for future scheduling features | **No** |
| `offline_access` | Maintain the connection without requiring re-authentication on every session | Yes (infrastructure) |
| `User.Read` | Read basic profile information (name, email address) to identify the account | Yes |

### Why are broad scopes requested if most are unused in the pilot?

This is a consequence of how enterprise Microsoft OAuth works, not a reflection of what the platform actually does with access.

**Microsoft's enterprise consent model is a one-time, administrator-approved grant.** In organisational Microsoft 365 tenants, individual users typically cannot grant OAuth consent on their own — an IT administrator must approve the permission request for the entire tenant. This approval happens once at the time of connection.

Microsoft does not support incremental authorisation for enterprise tenants — meaning it is not possible to request `Mail.Read` today, and then request `Mail.Send` three weeks later when the user enables a new feature, without returning to the IT administrator for a second approval cycle. This would be disruptive for both the organisation and the end user.

For this reason, augmtd — like all multi-feature Microsoft 365 integrations — requests the full set of scopes the platform *may use* across all its modules at the time of initial connection. **A granted scope is a permission, not an instruction.** Having `Mail.ReadWrite` granted does not cause augmtd to read any email. The platform only makes API calls that correspond to features the user has actively configured and enabled.

**In the context of this pilot:** the Microsoft OAuth grant has not yet been completed, so augmtd currently has no connection to the Chamber's Microsoft 365 tenant and is making no API calls of any kind. If the connection is established in a future phase, augmtd would begin synchronising mail and calendar data to build the AI context layer — contact recognition, communication patterns, scheduling context — as this is the core mechanism by which the platform delivers value. Any such activation would be agreed in advance and documented in the Data Processing Agreement.

### What augmtd does when a Microsoft connection is active

- Verifies the account identity (`User.Read`) at the time of login
- Maintains the session token (`offline_access`) for persistent access
- If `Mail.ReadWrite` is granted: synchronises incoming and sent emails to build AI context and, if the Inbox module is enabled, to surface them as AI-triaged work items
- If `Calendars.ReadWrite` is granted: synchronises upcoming meetings to provide scheduling context to the AI

The scope of active synchronisation is determined by which permissions are granted and which features are enabled at the time of connection. augmtd and the Chamber will define this scope together before any connection is established.

---

## 5. Feature Modularity

augmtd's features are independent modules. Each can be enabled or disabled at the account level. The following table reflects the full platform capability and pilot status:

| Module | Description | Pilot status |
|---|---|---|
| **Agent Workflows** | Automated multi-step pipelines (RSS, web, AI, content generation) | ✅ Active |
| **Email Inbox** | AI triage and drafting for connected email accounts | ⛔ Not connected |
| **Meeting Transcription** | Audio recording and transcription via in-person or bot capture | ⛔ Not connected |
| **Calendar Intelligence** | Meeting context and preparation briefs | ⛔ Not connected |
| **Knowledge Base** | Document indexing and semantic search | ⛔ Not connected |
| **AI Chat** | Contextual assistant drawing on all connected data sources | ⛔ Not connected |

### What controls data processing

**The account connection is the access gate — not the module toggle.** augmtd only processes data from a source when an authenticated connection to that source exists. When an email account is connected, the platform may use data from that account to build contextual intelligence — contact recognition, communication patterns, scheduling context — across features, because this background learning is what makes the AI useful over time. When no account is connected, no data from that source is collected, transmitted, or stored.

This is an important distinction: augmtd is designed as a contextual AI that learns from a user's working environment. That learning happens at the connection level, not at the feature level. The module toggles control what the user sees and interacts with; the connection approval controls what data flows into the platform.

### Current pilot guardrail

**For this pilot, the Microsoft OAuth grant has not been completed.** augmtd has no active connection to the Chamber's Microsoft 365 tenant. As a result, augmtd is making no API calls to any Microsoft endpoint — no mail, no calendar, no user directory. The absence of an approved OAuth connection is itself a structural data isolation guarantee: the platform has no credentials with which to access any organisational data.

If and when the connection is approved in a future phase, augmtd and the Chamber will agree in advance on which features are activated and what data processing is authorised. That agreement should be reflected in the Data Processing Agreement (see Section 10) before any connection is established.

---

## 6. Data Processing — What Is Processed and Where

### 6.1 Data processed during this pilot

| Data type | Source | Processing purpose | Stored? |
|---|---|---|---|
| Public news articles and RSS items | Public internet | Input to Executive Briefing workflow | Temporarily, as workflow output |
| Publicly accessible web pages | Public internet | Input to Executive Briefing workflow | Temporarily, as workflow output |
| AI-generated briefing content | augmtd AI pipeline | Delivered to user in-platform | Yes, as workflow run artifact |
| AI-generated LinkedIn draft content | augmtd AI pipeline | Delivered to user in-platform | Yes, as workflow run artifact |
| User account information (name, email) | Microsoft `User.Read` | Account identification and login | Yes, in user profile |
| Session tokens | Microsoft OAuth | Maintaining authenticated session | Yes, in database |

**No personal data of the Chamber's members, contacts, or email correspondents is processed during this pilot.**

### 6.2 Data that is NOT processed during this pilot

The following data types are not processed because **no connection to the relevant data source exists** for this pilot. This is a structural guarantee: without an approved OAuth grant or active connection, augmtd has no credentials to access these systems.

- Email content (subject lines, bodies, sender/recipient information)
- Calendar events or meeting attendee information
- Any audio or meeting recordings
- Any documents from connected storage (SharePoint, OneDrive)
- Any internal communications or directory data

### 6.3 Data flow for the Executive Briefing workflow

```
Public RSS feeds & web pages
        │
        ▼
augmtd Workflow Engine (Vercel EU)
        │
        ▼
AI Processing (AWS Bedrock — Frankfurt, eu-central-1)
        │  [only public article text is sent — no personal data]
        ▼
Synthesised briefing stored as workflow artifact
        │  (Supabase EU, isolated to your tenant)
        ▼
Delivered to user inside augmtd platform
```

---

## 7. Sub-processors

The following third-party services are used in the operation of augmtd. Each has a Data Processing Agreement in place with augmtd as required under GDPR Article 28(2).

| Sub-processor | Role | Location | Key certifications |
|---|---|---|---|
| **Supabase** | Database, file storage, authentication | EU region | SOC 2 Type II, GDPR, DPA available |
| **Vercel** | Application hosting and serverless compute | EU region | SOC 2 Type II, GDPR, DPA available |
| **Amazon Web Services** | All AI inference via Bedrock | EU (Frankfurt, eu-central-1) | ISO 27001/27017/27018, SOC 1/2/3, BSI C5, GDPR |
| **Hetzner Online GmbH** | Meeting audio transcription server (self-hosted Whisper model) | Germany (Nuremberg) | ISO 27001, German law applies, BSI-aligned |
| **Resend** | Outbound email delivery for messages your AI coworkers send on your behalf (only when you ask them to email someone) | USA (AWS-based) | SOC 2 Type II, GDPR, DPA available |
| **Tavily** | Web search for the optional web-research tools (receives search queries and public URLs only — never your documents, emails, or meetings) | USA / Israel | SOC 2 Type II, GDPR, DPA available |

**Notes:**

- **Resend and Tavily carry no stored customer content.** Resend sees only the outbound email a coworker sends at your instruction (the same text you reviewed before sending). Tavily sees only the search query a web-research tool issues and the public pages it returns; web research is a workspace feature that can be switched off entirely, and sovereign deployments run with it off. Neither service receives your mailbox, documents, meetings, or knowledge base.

- **AWS Bedrock (Frankfurt):** All AI processing in augmtd runs through AWS Bedrock in the Frankfurt (eu-central-1) region using Anthropic's Claude Haiku 4.5 model. This includes **semantic indexing (embeddings)** of your documents, which runs on Cohere Embed Multilingual via the same Bedrock EU endpoint — your documents are never sent to a separate embedding provider. Critically, in the Bedrock deployment model, **AWS operates the infrastructure and Anthropic supplies the model weights — augmtd does not have a direct data-processing relationship with Anthropic, and customer data is never transmitted to Anthropic's own servers.** All inference happens inside AWS's EU infrastructure. AWS Bedrock is BSI C5 certified — the German Federal Office for Information Security's cloud security framework — and does not use customer inputs or outputs for model training.

- **Hetzner:** Audio transcription (for the Meetings module, which is disabled in this pilot) runs on a dedicated server operated by augmtd in Hetzner's German data centre. The Whisper transcription model runs locally on this server — audio data never leaves augmtd-controlled infrastructure and is never sent to an external AI API. Hetzner is a German company and operates under German law, which enforces GDPR compliance as a baseline.

- **No US-based consumer AI services** (such as ChatGPT, public Claude.ai, or Gemini) are used in the processing of any customer data. All AI inference runs on AWS infrastructure within the EU.

---

## 8. Security Measures

| Measure | Implementation |
|---|---|
| Encryption at rest | All database content encrypted at rest by Supabase (AES-256) |
| Encryption in transit | TLS 1.2+ enforced on all connections |
| Tenant data isolation | Row-level security enforced at PostgreSQL database engine level — isolation is structural, not application-layer |
| OAuth token storage | Tokens stored in database, never exposed to the client or frontend |
| Access control | Users can only access their own organisation's data |
| API authentication | All API routes require authenticated session; JWT-validated server-side on every request |
| Security headers | HSTS (2-year), Content Security Policy, X-Frame-Options DENY, X-Content-Type-Options nosniff enforced on all responses |
| Rate limiting | Authentication, AI chat, and email send routes rate-limited per user |
| SSRF protection | Outbound URL fetch routes validate against an allowlist and block private IP ranges and cloud metadata endpoints |

augmtd does not currently hold SOC 2 certification. As an early-stage company, we rely on the certified infrastructure of our sub-processors (Supabase, Vercel, AWS) for the underlying security guarantees, and apply security best practices at the application layer as documented above.

---

## 9. Data Retention and Deletion

| Data type | Retention period | Deletion mechanism |
|---|---|---|
| Workflow run outputs (briefings, drafts) | Until deleted by user or account termination | Immediate deletion on request via Settings or account closure |
| OAuth tokens | Until account disconnected or connection revoked | Deleted immediately when user disconnects the Microsoft account |
| User profile data | Until account deletion | Full account deletion available via Settings |
| Processed emails (if Inbox module enabled in future) | Until deleted by user or account termination | Immediate deletion on request or account closure |

Upon written request following termination of the service relationship, augmtd will permanently delete all organisational data and provide written confirmation of deletion.

---

## 10. GDPR Roles

| Party | GDPR role | Basis |
|---|---|---|
| Chamber of Commerce | **Data Controller** | Determines the purposes and means of processing |
| augmtd | **Data Processor** | Processes data on behalf of the Controller, under instruction |
| AWS, Supabase, Vercel, Hetzner | **Sub-processors** | Process data on behalf of augmtd, under contract |

A formal Data Processing Agreement (DPA) under GDPR Article 28 between augmtd (Processor) and the Chamber of Commerce (Controller) is available and should be executed before production use of any feature that processes personal data.

**Note for the current pilot:** the Executive Briefing and LinkedIn post drafter workflows process only publicly available information and do not handle personal data of the Chamber's members, staff, or contacts. The requirement for a signed DPA is therefore most relevant in the context of future feature activation (Email Inbox, Calendar, Meetings).

---

## 11. Contact & Questions

For data protection, security, or compliance questions:

**Alexandre Collignon**  
augmtd  
alex@augmtd.ai  

---

*This document is provided for informational purposes to support the evaluation of augmtd's data processing practices. It does not constitute legal advice and does not replace a formal Data Processing Agreement.*
