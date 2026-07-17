/**
 * Batch email classifier — single AI call to pre-filter a batch of emails.
 *
 * Returns a map of emailId → 'process' | 'fyi_only' | 'noise' for each envelope.
 * Falls back to classifying all as 'fyi_only' if the AI call fails.
 */

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { SupabaseClient } from '@supabase/supabase-js';

export type EmailClass = 'process' | 'fyi_only' | 'noise';

export interface EmailEnvelope {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  /** First 500 chars of parsed email body — richer signal than snippet for borderline cases */
  body_preview?: string;
  /** A compact relationship signal ("known relationship — active deal X, 3 open commitments, met recently")
   *  assembled from the user's own data BEFORE this gate runs. When present, the sender is a known
   *  relationship / live deal — reason WITH it (a live-deal contact is never noise). See entity-context. */
  relationship?: string;
}

const SYSTEM_PROMPT = `You are an email triage classifier. Given a batch of email envelopes, classify each into exactly one category.

Each envelope includes: "from", "subject", "snippet" (email preview text), and optionally "body_preview" (first 500 characters of the email body). When "body_preview" is present, use it to resolve ambiguous cases — a snippet may look like a routine update while the body reveals an explicit question, request, or deadline.

CATEGORIES:

"noise" — The user does not need to see this. Use for:
- Marketing, promotions, discounts ("10% off", "sale", "deal", "offer")
- Newsletters, digests, editorial content (Substack, mailing lists)
- Automated system notifications (login alerts, sign-in detected, new device)
- Shipping/delivery confirmations, order receipts, booking confirmations
- Social media notifications (likes, follows, comments)
- Service status updates, uptime reports
- Automated daily/weekly digest emails ("Your Daily Digest", "Weekly Report")
- No-reply senders with purely informational content
- Sports club event announcements, golf tournaments, gym offers
- Ride receipts (Uber, Lyft, Bolt)
- Bank transaction alerts (automated, no action needed)
- App welcome emails, verify-email transactional flows
- Cron job / system monitoring alerts

"fyi_only" — The user may want to see this but does not need to act. Use for:
- Calendar invites accepted/declined/updated from known contacts
- Payment received confirmations (Wise, Stripe, PayPal — money coming IN)
- Invoice receipts for purchases already made
- Purely passive FYI from a person where NO reply is expected — a heads-up, a "just so you know", a thread you were CC'd on for awareness only, or a plain acknowledgement ("thanks!", "got it", "sounds good")
- Soft deadlines or reminders that don't require immediate action

"process" — The user must read and likely respond or decide. Use for:
- A human (not automated) is expecting a reply
- A client, partner, or colleague is asking a question or requesting action
- A reply (Re:) or direct message from a REAL PERSON in an ACTIVE conversation — even without an explicit question, an ongoing human exchange addressed to the user usually warrants attention (unless it's a pure acknowledgement)
- A contract, proposal, or document needs review or signature
- A meeting request or scheduling negotiation
- An urgent payment failure or billing issue that needs fixing
- A legal, compliance, or regulatory notice
- A job application, interview, or hiring decision
- Any email where ignoring it has a cost

IMPORTANT BIAS: When unsure between "fyi_only" and "process" for a message from a REAL HUMAN (not an automated/no-reply/bulk sender), choose "process". Reserve "fyi_only" for genuinely passive updates and acknowledgements. Automated/bulk senders never become "process" on this basis — they stay "noise" or "fyi_only".

RELATIONSHIP CONTEXT: some envelopes include a "relationship" note (e.g. "known relationship — active deal 'Acme Rollout', 3 open commitments, met recently"). This is what we ALREADY know about the sender/thread from the user's own data. Treat it as strong evidence the email is REAL CORRESPONDENCE the user cares about: an envelope with a "relationship" note must NOT be "noise", and when it names an active deal or open commitments, lean toward "process" (it's part of live work), reserving "fyi_only" only for a genuinely passive heads-up on that deal. Absence of the note is neutral (a brand-new contact can still be "process" on its own merits).

EXAMPLES:
- From: noreply@uber.com, Subject: "Your Thursday trip receipt" → noise
- From: info@zaask.pt, Subject: "✅ Os seus orçamentos estão a caminho!" → noise
- From: no-reply@accounts.google.com, Subject: "Alerta de segurança" → noise
- From: newsletter@substack.com, Subject: "The Guide to AI Research" → noise
- From: noreply@wise.com, Subject: "You got paid by ACME Ltd" → fyi_only
- From: calendar@google.com, Subject: "Updated invitation: Team Sync" → fyi_only
- From: client@company.com, Subject: "RE: Proposal feedback" → process
- From: partner@firm.com, Subject: "Contract revision needed" → process
- From: failed-payments@stripe.com, Subject: "Payment to Synthesia unsuccessful" → process
- From: client@company.com, Subject: "Quick update", body_preview: "...wanted to ask if you can confirm the budget before Thursday." → process (body reveals a question despite neutral subject)
- From: sam@partner.com, Subject: "Re: Follow up | Project" → process (active thread with a real person, even without an explicit question)
- From: colleague@company.com, Subject: "Re: Thanks!", body_preview: "Thanks so much, that's perfect." → fyi_only (pure acknowledgement, nothing to do)

Respond ONLY with valid JSON: { "results": [ { "id": "...", "class": "process"|"fyi_only"|"noise" } ] }
Include every id from the input. No explanations.`;

async function classifyBatch(
  envelopes: EmailEnvelope[],
  userId: string,
  adminSupabase: SupabaseClient,
): Promise<Map<string, EmailClass>> {
  const { client: ai, model } = await getAIClient(userId, 'classification', adminSupabase);

  const userContent = JSON.stringify(
    envelopes.map(e => {
      const entry: Record<string, string> = {
        id: e.id,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet?.slice(0, 150) ?? '',
      };
      // Include body_preview only when present — omitting saves tokens for envelope-only callers
      const preview = e.body_preview?.trim();
      if (preview) entry.body_preview = preview.slice(0, 500);
      if (e.relationship) entry.relationship = e.relationship;
      return entry;
    }),
  );

  // Dynamic token budget: ~80 tokens per result (body_preview adds ~20 tokens per email), minimum 1024
  const maxTokens = Math.min(4096, Math.max(1024, envelopes.length * 80));

  const response = await ai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — use it to judge urgency and deadlines.\n\n${SYSTEM_PROMPT}` },
      { role: 'user', content: userContent },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  });

  const text = response.choices[0]?.message?.content || '';
  const parsed = parseModelJSON<{ results: Array<{ id: string; class: string }> }>(text, { results: [] });

  const result = new Map<string, EmailClass>();
  for (const item of parsed.results) {
    const cls = item.class as EmailClass;
    if (['process', 'fyi_only', 'noise'].includes(cls)) {
      result.set(item.id, cls);
    }
  }

  // Fill missing ids with fyi_only (safer than process — avoids flooding inbox)
  for (const e of envelopes) {
    if (!result.has(e.id)) result.set(e.id, 'fyi_only');
  }

  return result;
}

export async function batchClassifyEmails(
  envelopes: EmailEnvelope[],
  userId: string,
  adminSupabase: SupabaseClient,
): Promise<Map<string, EmailClass>> {
  // Default: fyi_only (safer failure mode than process-all)
  const fallback = new Map<string, EmailClass>(envelopes.map(e => [e.id, 'fyi_only']));

  if (envelopes.length === 0) return fallback;

  try {
    let result: Map<string, EmailClass>;

    if (envelopes.length <= 50) {
      result = await classifyBatch(envelopes, userId, adminSupabase);
    } else {
      // Split large batches to avoid token truncation
      const half = Math.ceil(envelopes.length / 2);
      const [a, b] = await Promise.all([
        classifyBatch(envelopes.slice(0, half), userId, adminSupabase),
        classifyBatch(envelopes.slice(half), userId, adminSupabase),
      ]);
      result = new Map([...a, ...b]);
    }

    console.log(`[BatchClassify] ${envelopes.length} emails → process:${[...result.values()].filter(v => v === 'process').length} fyi:${[...result.values()].filter(v => v === 'fyi_only').length} noise:${[...result.values()].filter(v => v === 'noise').length}`);
    return result;
  } catch (err) {
    console.error('[BatchClassify] Failed, falling back to fyi-all:', err);
    return fallback;
  }
}
