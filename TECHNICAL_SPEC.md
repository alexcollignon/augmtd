# AUGMTD Technical Specification
**Version:** 1.0
**Last Updated:** 2026-02-05

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Product Vision & Positioning](#product-vision--positioning)
3. [High-Level Architecture](#high-level-architecture)
4. [Core Systems](#core-systems)
5. [Multi-Agent System](#multi-agent-system)
6. [User Context Engine](#user-context-engine)
7. [Integration Layer (n8n)](#integration-layer-n8n)
8. [Data Model](#data-model)
9. [Security & Compliance](#security--compliance)
10. [User Experience](#user-experience)
11. [Development Roadmap](#development-roadmap)
12. [Success Metrics](#success-metrics)

---

## Executive Summary

### What We're Building

**AUGMTD** is a personal digital twin platform for employees in regulated SMEs (50-500 employees). Unlike generic AI tools (ChatGPT, Copilot) or expensive enterprise solutions (Moveworks $150K+, Workato $50K+), AUGMTD:

1. **Learns how YOU work** - Personal context profile that improves over time
2. **Prepares your next steps proactively** - Inbox-driven UX, not chatbot
3. **Works cross-platform** - Google Workspace + Microsoft 365
4. **Ensures compliance** - Audit trails, human-in-the-loop, policy engine
5. **Affordable for SMEs** - $3-5K/user/year (not $150K+)

### Target Market

- **Primary**: Boutique consulting firms (10-50 employees)
- **Secondary**: Accounting, legal, healthcare practices
- **Tertiary**: Any regulated SME that can't use ChatGPT due to compliance

### Key Differentiation

| Feature | AUGMTD | Copilot Studio | Moveworks | Workato | ChatGPT Ent |
|---------|--------|----------------|-----------|---------|-------------|
| Personal context learning | ✅ | ❌ | ❌ | ❌ | ❌ |
| Human-in-the-loop | ✅ | Partial | Partial | ❌ | ✅ |
| Cross-platform (G+M) | ✅ | ❌ | ✅ | ✅ | ❌ |
| Compliance-first | ✅ | ✅ | ✅ | Partial | ✅ |
| Proactive inbox | ✅ | ❌ | Partial | ❌ | ❌ |
| SME affordable | ✅ | ✅ | ❌ | ❌ | ✅ |

---

## Product Vision & Positioning

### Vision Statement

> "Build a personal digital twin for every employee that learns how they work, prepares their next steps, and evolves into a digital twin of the entire organization's operations."

### Positioning Statement

> "AUGMTD is the only AI platform that learns individual work patterns and meets compliance requirements at an affordable price for SMEs. Unlike ChatGPT (no integrations) or Moveworks (too expensive), we combine personalization, execution, and governance."

### Roadmap Vision

- **Phase 1 (0-6 months)**: Email + meeting inbox with AI suggestions
- **Phase 2 (6-12 months)**: Workflow discovery and project linking
- **Phase 3 (12-18 months)**: Digital twin visualization of operations
- **Phase 4 (18-24 months)**: Predictive analytics and ROI tracking
- **Phase 5 (24+ months)**: Organization-wide optimization

---

## High-Level Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Work Inbox   │  │ Connections  │  │ Context      │     │
│  │              │  │              │  │ Insights     │     │
│  │ - Review     │  │ - OAuth      │  │ - Patterns   │     │
│  │ - Approve    │  │ - Manage     │  │ - Learning   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│                   API GATEWAY & AUTH                         │
│  - JWT Authentication                                        │
│  - Rate Limiting                                             │
│  - Request Routing                                           │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼──────┐  ┌───────▼────────┐
│   Inbox API    │  │Connection   │  │  Context API   │
│                │  │    API      │  │                │
└────────────────┘  └─────────────┘  └────────────────┘
        │
┌───────┴─────────────────────────────────────────────────────┐
│              ORCHESTRATION ENGINE (Core)                     │
│                                                              │
│  1. Event Router                                            │
│  2. Context Fetcher (ALWAYS FIRST)                          │
│  3. Agent Selector                                          │
│  4. Result Aggregator                                       │
│  5. Policy & Governance Layer                               │
│  6. Inbox Publisher                                         │
└──────────────────────────────────────────────────────────────┘
        │
        ├─────────────────────────────────────────────┐
        │                                             │
┌───────▼────────┐                          ┌─────────▼─────────┐
│ User Context   │                          │   Agent Registry  │
│    Engine      │                          │                   │
│                │                          │ - Email Agent     │
│ - Get context  │                          │ - Meeting Agent   │
│ - Learn        │                          │ - Draft Agent     │
│ - Vector search│                          │ - Document Agent  │
└────────────────┘                          │ - 20+ more...     │
        │                                   └───────────────────┘
        │                                             │
┌───────▼──────────────────────────────────┬─────────▼─────────┐
│        Integration Layer (n8n)           │  Shared Services  │
│                                          │                   │
│ - Gmail API                              │ - LLM Service     │
│ - Outlook API                            │ - Vector DB       │
│ - Google Calendar                        │ - Template Engine │
│ - Microsoft Teams                        │                   │
│ - Google Drive / OneDrive                │                   │
│ - Slack                                  │                   │
│ - 400+ other tools                       │                   │
└──────────────────────────────────────────┴───────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│                    DATA LAYER                                 │
│                                                               │
│  PostgreSQL:                                                  │
│  - users, organizations, inbox_items                         │
│  - user_context_profiles, learning_events                    │
│  - relationship_graph, communication_patterns                │
│  - emails, meetings, workflows                               │
│  - audit_logs, data_lineage                                  │
│                                                               │
│  Redis Cache:                                                 │
│  - Hot user contexts (5min TTL)                              │
│  - Active sessions                                            │
│                                                               │
│  Pinecone (Vector DB):                                        │
│  - Embeddings of communications                              │
│  - Similarity search                                          │
└───────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**
- Next.js 14 (React)
- TypeScript
- Tailwind CSS
- shadcn/ui components

**Backend:**
- Node.js 20+ with TypeScript
- Express.js (API layer)
- PostgreSQL 15+ (primary database)
- Redis 7+ (caching)
- Pinecone (vector database)

**Integration:**
- n8n (self-hosted, containerized)
- OAuth 2.0 for Google/Microsoft

**LLM Services:**
- OpenAI GPT-4 (complex reasoning)
- Anthropic Claude 3.5 (long context)
- OpenAI GPT-4o-mini (classification/routing)

**Infrastructure:**
- Docker + Kubernetes
- AWS (ECS, RDS, ElastiCache, S3)
- CloudFlare (CDN, DDoS protection)

---

## Core Systems

### 1. Orchestration Engine

**Purpose:** Central coordinator that receives events, fetches context, routes to agents, and creates inbox items.

**Key Responsibilities:**
1. **Event Routing**: Receive events from all sources (email, meetings, calendar)
2. **Context Loading**: Always fetch user context before agent execution
3. **Agent Coordination**: Determine which agents to invoke (parallel/sequential)
4. **Result Aggregation**: Combine outputs from multiple agents
5. **Policy Enforcement**: Check compliance before creating inbox items
6. **Inbox Publishing**: Create user-facing tasks with priority and confidence

**Flow:**
```
Event → Classify Intent → Fetch Context → Select Agents →
Execute Agents → Aggregate Results → Policy Check → Create Inbox Item
```

**Implementation:**
```typescript
class OrchestrationEngine {
  async processEvent(event: Event): Promise<void> {
    // 1. Fetch user context (cached, fast)
    const userContext = await this.contextEngine.getContext(event.userId);

    // 2. Classify event intent
    const classification = await this.classifyEvent(event);

    // 3. Plan agent execution
    const plan = await this.planAgentExecution(event, classification, userContext);

    // 4. Execute agents
    const results = await this.executeAgents(plan, event, userContext);

    // 5. Aggregate results
    const finalResult = await this.aggregateResults(results);

    // 6. Policy check
    const policyCheck = await this.policyAgent.check(finalResult, userContext);
    if (policyCheck.blocked) return;

    // 7. Create inbox item
    await this.createInboxItem(event.userId, finalResult);

    // 8. Async learning (non-blocking)
    setImmediate(() => this.contextEngine.updateContext(event.userId, {
      type: 'suggestion_generated',
      data: { event, finalResult }
    }));
  }
}
```

### 2. User Context Engine

**Purpose:** Learn and maintain a personalized profile of how each user works.

**What It Learns:**
- **Communication Style**: Tone, phrases, response patterns, length preferences
- **Decision Patterns**: Approval rates, typical edits, risk tolerance
- **Work Patterns**: Peak hours, task prioritization, delegation thresholds
- **Relationship Graph**: Contacts, importance levels, interaction history
- **Domain Knowledge**: Workflows, projects, vocabulary, file organization

**Key Features:**
- **Multi-layer caching**: Redis (5min) → PostgreSQL → Initialize new
- **Vector search**: Find similar past interactions for context
- **Async learning**: Updates happen in background, don't block users
- **Confidence scoring**: How much we've learned (0-100)

**Implementation:**
```typescript
class UserContextEngine {
  async getContext(userId: string): Promise<UserContextProfile> {
    // Layer 1: Redis cache
    const cached = await this.cache.get(`context:${userId}`);
    if (cached) return JSON.parse(cached);

    // Layer 2: PostgreSQL
    const profile = await this.db.getUserContext(userId);
    if (!profile) return await this.initializeContext(userId);

    // Cache for 5 minutes
    await this.cache.setex(`context:${userId}`, 300, JSON.stringify(profile));
    return profile;
  }

  async updateContext(userId: string, event: LearningEvent): Promise<void> {
    const context = await this.getContext(userId);

    // Route to learning handler
    switch (event.type) {
      case 'approval': await this.learnFromApproval(context, event); break;
      case 'rejection': await this.learnFromRejection(context, event); break;
      case 'modification': await this.learnFromModification(context, event); break;
    }

    // Recalculate confidence
    context.learningMetrics.confidenceScore = this.calculateConfidence(context);

    // Save and invalidate cache
    await this.saveContext(userId, context);
    await this.cache.del(`context:${userId}`);
  }
}
```

### 3. Agent Registry & Plugin System

**Purpose:** Modular system for managing all AI agents.

**Base Agent Interface:**
```typescript
interface Agent {
  name: string;
  version: string;
  description: string;
  capabilities: string[]; // e.g., ['email', 'draft', 'communication']

  canHandle(event: Event): boolean;
  process(event: Event, userContext: UserContextProfile): Promise<AgentResult>;
  calculateConfidence(userContext: UserContextProfile): number;
  explain(result: AgentResult): string;
}
```

**Agent Registry:**
```typescript
class AgentRegistry {
  private agents: Map<string, Agent> = new Map();
  private capabilities: Map<string, Set<string>> = new Map();

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
    agent.capabilities.forEach(capability => {
      if (!this.capabilities.has(capability)) {
        this.capabilities.set(capability, new Set());
      }
      this.capabilities.get(capability)!.add(agent.name);
    });
  }

  findByCapability(capability: string): Agent[] {
    const agentNames = this.capabilities.get(capability) || new Set();
    return Array.from(agentNames)
      .map(name => this.agents.get(name))
      .filter(Boolean) as Agent[];
  }
}
```

---

## Multi-Agent System

### Agent Categories

#### **Communication Agents**
- **Email Reply Agent**: Draft email responses matching user's style
- **Slack Response Agent**: Draft Slack messages with casual tone
- **SMS Reply Agent**: Brief, text-appropriate responses

#### **Productivity Agents**
- **Meeting Summary Agent**: Extract action items, decisions, attendees
- **Calendar Suggest Agent**: Find meeting slots considering preferences
- **Task Suggest Agent**: Create tasks from email/meeting context

#### **Document Agents**
- **Document Draft Agent**: Create documents matching templates/style
- **Contract Review Agent**: Extract terms, flag risks
- **Report Generate Agent**: Pull data, format, create charts

#### **Data & Analysis Agents**
- **Data Extract Agent**: Parse and structure data from unstructured sources
- **Research Summary Agent**: Gather info from multiple sources, cite
- **Sentiment Analysis Agent**: Detect tone, urgency, importance

#### **Workflow Agents**
- **Workflow Suggest Agent**: Detect recurring patterns, suggest automation
- **Approval Route Agent**: Determine approver based on context
- **Status Update Agent**: Generate project status reports

#### **Intelligence Agents**
- **Intent Classify Agent**: Parse intent from text (REQUEST, INFO, URGENT)
- **Similarity Match Agent**: Vector search for similar past interactions
- **Prediction Agent**: Proactive suggestions for what's coming next

#### **Custom Domain Agents**
- **Legal Clause Agent**: Industry-specific templates and language
- **Accounting Entry Agent**: Tax rules, classification
- **HR Onboarding Agent**: New hire checklists and docs

### Example: Email Reply Agent

```typescript
class EmailReplyAgent implements Agent {
  name = 'email_reply';
  capabilities = ['email', 'draft', 'communication'];

  async process(
    event: Event,
    userContext: UserContextProfile
  ): Promise<AgentResult> {
    const email = event.data as Email;

    // 1. Find similar past emails
    const similarInteractions = await this.vectorDB.findSimilar(
      userContext.userId,
      email.body,
      'email_reply',
      3
    );

    // 2. Get sender context
    const senderContext = userContext.relationshipGraph.contacts.find(
      c => c.email === email.fromAddress
    );

    // 3. Get relevant projects
    const projects = this.findRelevantProjects(email, userContext);

    // 4. Generate draft
    const draft = await this.generateReply(
      email,
      userContext.communicationStyle.emailResponsePatterns,
      senderContext,
      projects,
      similarInteractions
    );

    // 5. Calculate confidence
    const confidence = this.calculateConfidence(
      userContext,
      senderContext,
      similarInteractions
    );

    return {
      type: 'email_reply',
      content: draft,
      confidence,
      reasoning: this.generateReasoning(email, senderContext, projects)
    };
  }

  private async generateReply(
    email: Email,
    style: CommunicationStyle,
    senderContext: Contact | undefined,
    projects: Project[],
    similarInteractions: SimilarInteraction[]
  ): Promise<string> {
    const prompt = `
You are drafting an email reply. Match the user's style exactly.

USER'S STYLE:
- Tone: ${style.tone}
- Length: ${style.typicalLength}
- Common phrases: ${style.commonPhrases.slice(0, 5).join(', ')}
- Signature: ${style.signatureStyle}

${senderContext ? `
SENDER: ${senderContext.name} (${senderContext.relationship})
- Importance: ${senderContext.importance}/100
- Typical topics: ${senderContext.typicalTopics.join(', ')}
` : ''}

${projects.length > 0 ? `
RELEVANT PROJECTS: ${projects.map(p => p.name).join(', ')}
` : ''}

INCOMING EMAIL:
From: ${email.fromAddress}
Subject: ${email.subject}
Body: ${email.body}

Draft a reply matching the user's style:`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });

    return response.choices[0].message.content;
  }
}
```

### Agent Coordination Patterns

**Pattern 1: Parallel Execution**
```
Document Request Email Arrives
    │
    ├─→ Document Extract Agent (find file)
    ├─→ Calendar Agent (check deadline feasibility)
    ├─→ Sentiment Agent (detect urgency)
    └─→ [All execute in parallel]
         │
         └─→ Results combined → Email Draft Agent → Inbox Item
```

**Pattern 2: Sequential Execution**
```
Complex Email Arrives
    │
    └─→ Intent Classify Agent
         │
         ├─ If DOCUMENT_REQUEST → Document Extract Agent → Email Draft Agent
         ├─ If MEETING_REQUEST → Calendar Agent → Email Draft Agent
         └─ If INFO_REQUEST → Research Agent → Email Draft Agent
```

**Pattern 3: Multi-Agent Collaboration**
```
Contract Review Request
    │
    ├─→ Document Extract Agent (find contract)
    └─→ Contract Review Agent
         ├─→ Extract terms
         ├─→ Flag risks
         ├─→ Compare to templates
         └─→ Draft summary email → Inbox Item
```

---

## User Context Engine

### Context Profile Structure

```typescript
interface UserContextProfile {
  userId: string;

  // Communication patterns
  communicationStyle: {
    emailResponsePatterns: {
      avgResponseTime: Record<string, number>; // by sender type
      typicalLength: 'brief' | 'detailed' | 'varies';
      tone: 'formal' | 'casual' | 'mixed';
      commonPhrases: string[];
      signatureStyle: string;
    };
    slackPatterns?: {
      tone: 'casual' | 'professional';
      useEmojis: boolean;
      avgLength: 'brief' | 'medium';
    };
  };

  // Work patterns
  workPatterns: {
    typicalWorkHours: { start: string; end: string };
    peakProductivityHours: string[];
    taskPrioritization: 'deadline-driven' | 'importance-first' | 'quick-wins';
    delegationThreshold: number; // complexity threshold
    reviewThoroughness: 'quick-scan' | 'detailed' | 'varies-by-type';
  };

  // Decision patterns
  decisionPatterns: {
    approvalRateByType: Record<string, number>;
    typicalEdits: {
      type: string;
      pattern: string;
      frequency: number;
      examples: Array<{ original: string; modified: string }>;
    }[];
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  };

  // Relationship graph
  relationshipGraph: {
    contacts: {
      email: string;
      name: string;
      relationship: 'client' | 'internal' | 'vendor' | 'other';
      importance: number; // 0-100
      interactionFrequency: number;
      lastInteraction: Date;
      typicalTopics: string[];
      preferredChannel: 'email' | 'meeting' | 'both';
    }[];
    projects: {
      id: string;
      name: string;
      activeContacts: string[];
      stage: string;
      urgency: number;
    }[];
  };

  // Domain knowledge
  domainKnowledge: {
    vocabulary: Record<string, string>; // terms, acronyms
    workflows: {
      id: string;
      name: string;
      frequency: string;
      steps: string[];
      userRole: 'owner' | 'contributor' | 'reviewer';
    }[];
    documentPatterns: {
      type: string;
      typicalLocation: string;
      namingConvention: string;
    }[];
  };

  // Learning metrics
  learningMetrics: {
    totalInteractions: number;
    approvalRate: number;
    avgTimeToReview: number;
    confidenceScore: number; // 0-100
    lastUpdated: Date;
  };
}
```

### Learning Events

**Types of Learning:**
1. **Approval**: User approves AI suggestion without changes
2. **Rejection**: User dismisses AI suggestion
3. **Modification**: User edits AI suggestion before using
4. **Interaction**: User takes action (sends email, schedules meeting)

**Example Learning Flow:**
```typescript
// User modifies email draft before sending
async handleModification(
  userId: string,
  inboxItemId: string,
  originalContent: string,
  modifiedContent: string
) {
  const inboxItem = await this.getInboxItem(inboxItemId);

  // Extract edit pattern using LLM
  const pattern = await this.extractEditPattern(originalContent, modifiedContent);

  // Update context
  await this.contextEngine.updateContext(userId, {
    type: 'modification',
    category: 'communication_style',
    data: {
      inboxItem,
      originalContent,
      modifiedContent,
      pattern: pattern.description
    }
  });

  // Store embeddings for future similarity matching
  await this.vectorDB.upsert({
    id: `modification-${inboxItemId}`,
    values: await this.embed(modifiedContent),
    metadata: {
      userId,
      type: inboxItem.type,
      editPattern: pattern.description,
      timestamp: Date.now()
    }
  });
}
```

### Confidence Scoring

```typescript
calculateConfidence(context: UserContextProfile): number {
  const { totalInteractions, approvalRate } = context.learningMetrics;

  // Need minimum interactions to be confident
  if (totalInteractions < 10) return totalInteractions * 5; // 0-50

  // Combine interaction volume and approval rate
  const volumeScore = Math.min(totalInteractions / 100, 1) * 50; // 0-50
  const qualityScore = approvalRate * 50; // 0-50

  return Math.round(volumeScore + qualityScore);
}
```

---

## Integration Layer (n8n)

### Why n8n?

**Advantages:**
- 400+ pre-built integrations (Gmail, Outlook, Slack, Teams, Drive, OneDrive, etc.)
- Self-hosted (data stays private)
- Workflow orchestration built-in
- OAuth management included
- Active development and community

**Architecture:**
```
AUGMTD Services
      │
      ├─→ n8n Workflow Execution API
      │    │
      │    ├─→ Gmail Node (fetch emails, send emails)
      │    ├─→ Outlook Node (fetch emails, send emails)
      │    ├─→ Google Calendar Node (list events, create events)
      │    ├─→ Microsoft Teams Node (get meetings, transcripts)
      │    ├─→ Google Drive Node (search files, share links)
      │    ├─→ OneDrive Node (search files, share links)
      │    └─→ Slack Node (read messages, send messages)
      │
      └─→ n8n Credential Management API
           (Store user OAuth tokens)
```

### n8n Deployment

**Container Setup:**
```yaml
# docker-compose.yml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:latest
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - N8N_HOST=${N8N_HOST}
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=${N8N_WEBHOOK_URL}
      - GENERIC_TIMEZONE=America/New_York
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=${POSTGRES_USER}
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - n8n_data:/home/node/.n8n
    ports:
      - "5678:5678"
    depends_on:
      - postgres
```

### Email Sync Workflow

**Gmail Fetch Workflow (n8n):**
```json
{
  "name": "Gmail Fetch - User ${userId}",
  "nodes": [
    {
      "name": "Schedule",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{ "field": "minutes", "minutesInterval": 5 }]
        }
      }
    },
    {
      "name": "Gmail",
      "type": "n8n-nodes-base.gmail",
      "credentials": { "gmailOAuth2": "user_${userId}_gmail" },
      "parameters": {
        "operation": "getAll",
        "returnAll": false,
        "limit": 50,
        "filters": {
          "labelIds": ["INBOX"],
          "q": "is:unread"
        }
      }
    },
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "httpMethod": "POST",
        "path": "augmtd/email-received",
        "responseMode": "onReceived"
      }
    }
  ],
  "connections": {
    "Schedule": { "main": [[{ "node": "Gmail", "type": "main", "index": 0 }]] },
    "Gmail": { "main": [[{ "node": "Webhook", "type": "main", "index": 0 }]] }
  }
}
```

### Service Integration

```typescript
class EmailService {
  constructor(private n8nClient: N8nClient) {}

  async fetchNewEmails(userId: string): Promise<Email[]> {
    const provider = await this.getUserEmailProvider(userId);

    // Execute n8n workflow
    const result = await this.n8nClient.executeWorkflow({
      workflowId: `email-fetch-${userId}`,
      data: { userId, provider }
    });

    return result.data.map(item => this.parseEmailFromN8n(item));
  }

  async sendEmail(userId: string, email: EmailDraft): Promise<void> {
    const provider = await this.getUserEmailProvider(userId);

    const workflow = provider === 'gmail'
      ? this.buildGmailSendWorkflow(email)
      : this.buildOutlookSendWorkflow(email);

    await this.n8nClient.executeWorkflow({
      workflowId: workflow.id,
      data: { userId, email }
    });
  }
}
```

---

## Data Model

### Core Tables

```sql
-- Users and Organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) DEFAULT 'trial',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Inbox Items (core UX)
CREATE TABLE inbox_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255),
  source_data JSONB NOT NULL,

  ai_suggestion_type VARCHAR(100),
  ai_suggestion_content TEXT,
  ai_suggestion_reasoning TEXT,
  confidence_score INTEGER,

  status VARCHAR(50) DEFAULT 'pending',
  priority INTEGER DEFAULT 50,
  needs_review BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  executed_at TIMESTAMP,

  CONSTRAINT confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CONSTRAINT priority_range CHECK (priority >= 0 AND priority <= 100)
);

CREATE INDEX idx_inbox_user_status ON inbox_items(user_id, status);
CREATE INDEX idx_inbox_priority ON inbox_items(priority DESC, created_at DESC);

-- User Context Profiles
CREATE TABLE user_context_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),

  context_data JSONB NOT NULL,

  confidence_score INTEGER DEFAULT 0,
  total_interactions INTEGER DEFAULT 0,
  overall_approval_rate DECIMAL(5,2) DEFAULT 0.00,

  created_at TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW(),

  CONSTRAINT context_confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

-- Learning Events
CREATE TABLE context_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  inbox_item_id UUID REFERENCES inbox_items(id),

  event_type VARCHAR(50) NOT NULL,
  learning_category VARCHAR(50),
  learning_data JSONB,
  confidence_delta DECIMAL(5,2),

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_learning_user_time ON context_learning_events(user_id, created_at DESC);

-- Relationship Graph
CREATE TABLE relationship_graph (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  contact_email VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  relationship_type VARCHAR(50),
  importance INTEGER DEFAULT 50,
  interaction_frequency INTEGER DEFAULT 0,
  last_interaction TIMESTAMP,

  typical_topics TEXT[],
  preferred_channel VARCHAR(50),
  context_data JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, contact_email)
);

CREATE INDEX idx_relationship_user ON relationship_graph(user_id);
CREATE INDEX idx_relationship_importance ON relationship_graph(user_id, importance DESC);

-- Source Data
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  message_id VARCHAR(500) UNIQUE,
  from_address VARCHAR(255),
  from_name VARCHAR(255),
  to_addresses TEXT[],

  subject TEXT,
  body TEXT,
  received_at TIMESTAMP,
  thread_id VARCHAR(500),

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_emails_user_time ON emails(user_id, received_at DESC);

CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  meeting_id VARCHAR(500) UNIQUE,
  title VARCHAR(500),
  participants TEXT[],
  start_time TIMESTAMP,
  end_time TIMESTAMP,

  notes TEXT,
  transcript TEXT,

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_meetings_user_time ON meetings(user_id, start_time DESC);

-- Connections
CREATE TABLE connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  provider VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  n8n_credential_id VARCHAR(255),

  last_sync TIMESTAMP,
  sync_status VARCHAR(50),
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_connections_user ON connections(user_id, provider);

-- Audit & Compliance
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),

  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  details JSONB,

  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_org_time ON audit_logs(organization_id, created_at DESC);

CREATE TABLE data_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_item_id UUID REFERENCES inbox_items(id),

  source_data_ids TEXT[],
  agent_models_used TEXT[],
  context_version VARCHAR(50),

  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Security & Compliance

### Compliance-First Architecture

**Key Requirements:**
- SOC 2 Type II certification
- HIPAA compliance (healthcare customers)
- GDPR compliance (EU customers)
- EU AI Act compliance (starting August 2026)

### Security Features

**1. Data Lineage**
Every AI suggestion tracks:
- Which emails/meetings informed it
- Which LLM models were used
- Which user context version was used
- Timestamp and confidence scores

```sql
-- Example data lineage record
INSERT INTO data_lineage (inbox_item_id, source_data_ids, agent_models_used, context_version)
VALUES (
  'inbox-item-123',
  ARRAY['email-456', 'meeting-789'],
  ARRAY['gpt-4', 'email_reply_agent_v1.0'],
  'user_context_v47'
);
```

**2. Audit Trails**
All actions logged:
```typescript
await auditLog.create({
  userId: user.id,
  organizationId: user.organizationId,
  action: 'INBOX_ITEM_APPROVED',
  resourceType: 'inbox_item',
  resourceId: inboxItem.id,
  details: {
    suggestionType: inboxItem.type,
    confidence: inboxItem.confidenceScore,
    agentsUsed: inboxItem.metadata.agents_used
  },
  ipAddress: req.ip,
  userAgent: req.headers['user-agent']
});
```

**3. Policy Engine**
Block suggestions that violate rules:
```typescript
class PolicyAgent implements Agent {
  async check(
    suggestion: AISuggestion,
    userContext: UserContextProfile
  ): Promise<PolicyCheckResult> {
    const violations = [];

    // Check 1: External communications must be reviewed
    if (this.isExternalCommunication(suggestion) && suggestion.autoExecute) {
      violations.push('External communications require human review');
    }

    // Check 2: Sensitive data patterns
    if (this.containsSensitiveData(suggestion.content)) {
      violations.push('Contains PII/PHI that should be reviewed');
    }

    // Check 3: Company-specific policies
    const customPolicies = await this.getOrganizationPolicies(
      userContext.organizationId
    );
    for (const policy of customPolicies) {
      if (!policy.validate(suggestion)) {
        violations.push(policy.violationMessage);
      }
    }

    return {
      blocked: violations.length > 0,
      violations,
      requiresReview: this.calculateReviewRequirement(suggestion, violations)
    };
  }
}
```

**4. Role-Based Access Control (RBAC)**
```typescript
// Users only see data they're authorized for
async getInboxItems(userId: string): Promise<InboxItem[]> {
  const user = await this.getUser(userId);
  const accessibleProjects = await this.getAccessibleProjects(user);

  return await db.inboxItems.findMany({
    where: {
      userId,
      OR: [
        { visibility: 'private' },
        { projectId: { in: accessibleProjects.map(p => p.id) } }
      ]
    }
  });
}
```

**5. Private Execution**
All AI processing in isolated containers:
```
User Data → Isolated Container (GPT-4 API call) → Response → AUGMTD
                                                    │
                                                    └─→ No data retention
                                                        by OpenAI (enterprise)
```

### Data Encryption

- **At rest**: PostgreSQL encryption (AWS RDS encryption)
- **In transit**: TLS 1.3 for all connections
- **Secrets**: AWS Secrets Manager for API keys, credentials

---

## User Experience

### Primary Screens

#### 1. Work Inbox (Core UX)

```
┌────────────────────────────────────────────────────────────┐
│  AUGMTD                                    [Settings] [👤] │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Work Inbox                    🔍 Search    📊 Insights    │
│  ────────────────────────────────────────────────────      │
│                                                             │
│  Filters: [All] [High Priority] [Pending] [Completed]     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 🔴 HIGH PRIORITY                          Confidence  │ │
│  │                                                92% 🟢 │ │
│  │ Reply to Sarah Johnson (VIP Client)                  │ │
│  │ Re: Q4 Report Request                                │ │
│  │                                                        │ │
│  │ AI found Q4 report and drafted reply with link.      │ │
│  │ Thursday deadline is feasible.                        │ │
│  │                                                        │ │
│  │ [Review Draft]  [Send Now]  [Dismiss]                │ │
│  │                                                        │ │
│  │ 2 minutes ago • Email • 3 agents used                │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 🟡 MEDIUM PRIORITY                        Confidence  │ │
│  │                                                78% 🟡 │ │
│  │ Meeting Summary: Product Roadmap Discussion          │ │
│  │                                                        │ │
│  │ 5 action items extracted, 2 assigned to you          │ │
│  │                                                        │ │
│  │ [View Summary]  [Approve]  [Edit]                    │ │
│  │                                                        │ │
│  │ 15 minutes ago • Meeting • 2 agents used             │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 🟢 LOW PRIORITY                           Confidence  │ │
│  │                                                85% 🟢 │ │
│  │ Weekly Status Update Draft Ready                     │ │
│  │                                                        │ │
│  │ Based on your meetings and emails this week          │ │
│  │                                                        │ │
│  │ [Review]  [Send]  [Skip]                             │ │
│  │                                                        │ │
│  │ 1 hour ago • Workflow • 4 agents used                │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

#### 2. Inbox Item Detail View

```
┌────────────────────────────────────────────────────────────┐
│  ← Back to Inbox                                            │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Reply to Sarah Johnson                                    │
│  Re: Q4 Report Request                                     │
│  ───────────────────────────────────────────────           │
│                                                             │
│  📧 ORIGINAL EMAIL                                         │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ From: sarah.johnson@client.com                        │ │
│  │ To: you@company.com                                   │ │
│  │ Subject: Q4 Report Request                            │ │
│  │                                                        │ │
│  │ Hi [Name],                                            │ │
│  │                                                        │ │
│  │ Can you send me the Q4 report by Thursday?           │ │
│  │                                                        │ │
│  │ Thanks,                                               │ │
│  │ Sarah                                                 │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ✨ AI SUGGESTED REPLY                                     │
│  Confidence: 92% 🟢  •  Priority: HIGH 🔴                  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Hi Sarah,                                             │ │
│  │                                                        │ │
│  │ Attached is the Q4 report you requested:             │ │
│  │ https://drive.google.com/file/d/xyz...                │ │
│  │                                                        │ │
│  │ Thursday works perfectly. Let me know if you need    │ │
│  │ anything else.                                        │ │
│  │                                                        │ │
│  │ Best,                                                 │ │
│  │ [Your name]                                           │ │
│  │                                                        │ │
│  │ [Edit Draft]                                          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  💡 AI REASONING                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ • Found Q4 report in /Reports/Quarterly/             │ │
│  │   (matches your typical naming pattern)              │ │
│  │ • Sarah Johnson is a VIP client (importance: 95/100) │ │
│  │ • Thursday deadline is feasible (3 days away)        │ │
│  │ • Drafted reply matching your professional tone      │ │
│  │ • Used Drive link (you prefer links over files)     │ │
│  │ • Similar to 3 past emails you approved              │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  🔍 WHAT WAS USED                                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Agents: Document Extract, Calendar, Sentiment,       │ │
│  │         Email Draft, Policy Check                     │ │
│  │                                                        │ │
│  │ Context: Your communication style, Sarah's profile,  │ │
│  │          3 similar past emails                        │ │
│  │                                                        │ │
│  │ Data sources: Email, Google Drive, Calendar          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  [Send Now]  [Edit Draft]  [Dismiss]  [Give Feedback]    │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

#### 3. Context Insights

```
┌────────────────────────────────────────────────────────────┐
│  How You Work - Context Insights                           │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Learning Confidence: 87% 🟢                               │
│  Total Interactions: 156                                    │
│  Approval Rate: 89%                                         │
│  ───────────────────────────────────────────────           │
│                                                             │
│  📧 COMMUNICATION STYLE                                    │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Tone: Professional, concise                           │ │
│  │ Avg response time: 2-4 hours                          │ │
│  │ Typical length: 3-5 sentences                         │ │
│  │ Common phrases:                                       │ │
│  │   • "Attached is..."                                  │ │
│  │   • "Let me know if..."                               │ │
│  │   • "Happy to help"                                   │ │
│  │                                                        │ │
│  │ Preferences:                                          │ │
│  │   • Uses Drive links (not attachments)                │ │
│  │   • Signs with "Best,"                                │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  👥 KEY RELATIONSHIPS                                      │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Sarah Johnson (Client)                 Importance 95  │ │
│  │   → 23 interactions, always priority                  │ │
│  │   → Topics: Reports, data analysis                    │ │
│  │                                                        │ │
│  │ Mike Chen (Internal)                   Importance 78  │ │
│  │   → 45 interactions, casual tone                      │ │
│  │   → Topics: Project updates, feedback                 │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ⚙️ WORK PATTERNS                                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Typical hours: 9am - 6pm EST                          │ │
│  │ Peak productivity: 10am-12pm, 2pm-4pm                │ │
│  │ Task prioritization: Deadline-driven                  │ │
│  │ Delegation threshold: Medium complexity               │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  [Export Context Data]  [Privacy Settings]                │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## Development Roadmap

### Phase 1: MVP (Weeks 1-8)
**Goal:** Email + meeting inbox with AI suggestions

**Features:**
- OAuth setup for Gmail + Google Calendar
- OAuth setup for Outlook + Microsoft Teams
- n8n integration for email/meeting sync
- Basic user context engine (communication style learning)
- 3 core agents: Email Reply, Meeting Summary, Intent Classify
- Inbox UI with review/approve flow
- PostgreSQL + Redis + Pinecone setup
- Audit logging

**Success Criteria:**
- 2 beta customers using daily
- 70%+ approval rate on AI suggestions
- Sub-50ms context fetch time
- SOC 2 prep completed

### Phase 2: Enhanced Context (Weeks 9-16)
**Goal:** Deeper personalization and learning

**Features:**
- Add 5 more agents: Calendar Suggest, Document Extract, Draft, Task Suggest, Sentiment
- Relationship graph building
- Vector similarity search for past interactions
- Modification learning (track edits)
- Context insights dashboard
- Support for Slack integration
- Policy engine (basic rules)

**Success Criteria:**
- 85%+ approval rate
- 10 paying customers
- Avg 10-15 hours/week saved per user
- Context confidence 80%+ after 50 interactions

### Phase 3: Workflow Discovery (Weeks 17-24)
**Goal:** Detect patterns and suggest workflows

**Features:**
- Workflow pattern detection
- Project/goal linking
- Recurring task automation
- Proactive suggestions ("Sarah usually asks for Q4 report around now")
- Custom domain agents (legal, accounting, etc.)
- Advanced policy engine with custom rules
- API for third-party integrations

**Success Criteria:**
- 50 paying customers
- 3-5 workflows detected per user
- $30K+ MRR
- Net Promoter Score (NPS) 50+

### Phase 4: Digital Twin Visualization (Weeks 25-36)
**Goal:** Show how work flows through organization

**Features:**
- Visual workflow maps
- Bottleneck detection
- Time tracking and ROI analytics
- Predictive suggestions
- Team collaboration features
- Multi-user workflows
- Advanced reporting

**Success Criteria:**
- 100+ paying customers
- $100K+ MRR
- Customers renewing at 95%+ rate
- Expansion to 20+ users per org

---

## Success Metrics

### Product Metrics

**User Engagement:**
- Daily Active Users (DAU) / Monthly Active Users (MAU)
- Inbox items per user per day (target: 5-10)
- Time spent in app per day (target: 15-20 minutes)
- Actions per session (review, approve, modify)

**AI Quality:**
- Approval rate (target: 85%+)
- Modification rate (target: <30%)
- Rejection rate (target: <10%)
- Average confidence score (target: 80%+)

**Learning Effectiveness:**
- Context confidence growth over time
- Approval rate improvement (week 1 vs week 12)
- Time to high confidence (target: 50 interactions)

**Time Savings:**
- Hours saved per user per week (target: 10-15)
- Email response time reduction
- Meeting follow-up time reduction

### Business Metrics

**Customer Acquisition:**
- Sign-ups per week
- Trial-to-paid conversion (target: 30%+)
- Cost per acquisition (CPA)

**Revenue:**
- Monthly Recurring Revenue (MRR)
- Average Revenue Per User (ARPU): $3-5K/year
- Annual Contract Value (ACV)

**Retention:**
- Monthly churn (target: <5%)
- Net Revenue Retention (NRR) (target: 110%+)
- Customer Lifetime Value (LTV)

**Expansion:**
- Users per organization growth
- Upsell rate (basic → pro → enterprise)

### Compliance Metrics

- Audit log completeness (target: 100%)
- Data lineage coverage (target: 100%)
- Policy violation rate (target: <1%)
- SOC 2 audit results
- Security incident rate (target: 0)

---

## Appendix

### Tech Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 14, TypeScript, Tailwind | Web app |
| API | Node.js, Express, TypeScript | Backend services |
| Database | PostgreSQL 15+ | Primary data store |
| Cache | Redis 7+ | Context caching |
| Vector DB | Pinecone | Similarity search |
| Integration | n8n (self-hosted) | Email, calendar, etc. |
| LLM | GPT-4, Claude 3.5, GPT-4o-mini | AI agents |
| Infrastructure | AWS (ECS, RDS, ElastiCache) | Hosting |
| Monitoring | DataDog | Observability |

### Key Dependencies

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "typescript": "^5.3.0",
    "express": "^4.18.0",
    "pg": "^8.11.0",
    "redis": "^4.6.0",
    "@pinecone-database/pinecone": "^1.1.0",
    "openai": "^4.20.0",
    "@anthropic-ai/sdk": "^0.9.0",
    "n8n-sdk": "^1.0.0"
  }
}
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/augmtd
REDIS_URL=redis://localhost:6379

# External Services
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PINECONE_API_KEY=...
PINECONE_ENVIRONMENT=us-west1-gcp

# n8n
N8N_HOST=localhost
N8N_PORT=5678
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=...

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...

# App
JWT_SECRET=...
APP_URL=https://app.augmtd.com
ENVIRONMENT=production
```

---

**Document Version:** 1.0
**Last Updated:** 2026-02-05
**Next Review:** 2026-03-05
