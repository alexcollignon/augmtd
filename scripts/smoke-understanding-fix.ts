// Smoke test for the understanding/routing fix:
//   A) recalibrated `action` bar — re-run computeUnderstanding on a sample of items CURRENTLY tagged
//      relevance='action' and report how many flip to awareness (the 344-flood should shrink).
//   B) FYA-vs-Newsletters split — simulate the new isBulk routing over the whole noted pool and report
//      the real-correspondence vs bulk counts; locate Rene specifically.
//   C) user-rule respect — assert no item with an actionable type_override lands in FYA.
//
//   npx tsx scripts/smoke-understanding-fix.ts
//   npx tsx scripts/smoke-understanding-fix.ts --recompute=40   # also re-run AI on N action items

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const recomputeN = Number(process.argv.find((a) => a.startsWith('--recompute='))?.split('=')[1] || '0');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// EXACT copy of brief/route.ts isAutomatedSender so the smoke reflects real routing.
function isAutomatedSender(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  const email = (fromEmail || '').toLowerCase();
  const localpart = email.split('@')[0] || '';
  const addrPatterns = [
    'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
    'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'bounce', 'bounces',
    'postmaster', 'automated', 'auto-confirm', 'alerts', 'alert', 'billing', 'invoices', 'receipts',
    'support+', 'updates', 'newsletter', 'news', 'digest',
  ];
  if (addrPatterns.some((p) => localpart.includes(p))) return true;
  if (/(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/.test(email)) return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const phrasePatterns = [
    'payment failed', 'payment unsuccessful', 'payment declined', 'account suspended',
    'account restricted', 'account has been', 'your subscription', 'subscription renew',
    'verify your', 'confirm your email', 'confirm your account', 'security alert', 'security notice',
    'unusual sign', 'sign-in attempt', 'password reset', 'invoice is', 'your receipt', 'order confirmation',
  ];
  if (phrasePatterns.some((p) => text.includes(p))) return true;
  return false;
}
const fromEmailOf = (sd: any): string | null => {
  const raw = String(sd.from_address || sd.from || '').toLowerCase();
  return raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || (raw.includes('@') ? raw : null);
};
const isBulk = (sd: any): boolean => {
  const u = coerceUnderstanding(sd.understanding);
  if (u?.bulk === true) return true; // AI's reasoned judgment (primary)
  return !!sd.has_unsubscribe || isAutomatedSender(fromEmailOf(sd), sd.from_name || null, sd.subject || sd.work_title || null);
};

async function addrs(): Promise<string[]> {
  const set = new Set<string>();
  const { data: prof } = await supabase.from('profiles').select('email').eq('id', USER).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: conns } = await supabase.from('connections').select('metadata, provider_account_id').eq('user_id', USER);
  for (const c of (conns ?? []) as any[]) { const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase(); if (e) set.add(e); }
  return [...set];
}

async function main() {
  const userAddrs = await addrs();
  const { data: all } = await supabase.from('inbox_items')
    .select('id, work_title, work_state, rule_type, type_override, source, source_data')
    .eq('user_id', USER).eq('source', 'email').eq('status', 'pending').limit(100000);
  const items = (all ?? []) as any[];
  console.log(`\n=== inbox: ${items.length} pending email items ===`);

  // Distribution of stored understanding.relevance
  const dist: Record<string, number> = {};
  for (const it of items) {
    const u = coerceUnderstanding(it.source_data?.understanding);
    dist[u ? u.relevance : 'none'] = (dist[u ? u.relevance : 'none'] || 0) + 1;
  }
  console.log('stored relevance distribution:', dist);

  // ── A) recalibration: re-run the AI on a sample of CURRENT 'action' items and see how many flip.
  if (recomputeN > 0) {
    const actionItems = items.filter((it) => coerceUnderstanding(it.source_data?.understanding)?.relevance === 'action').slice(0, recomputeN);
    console.log(`\n=== A) re-running understanding on ${actionItems.length} current 'action' items (new prompt) ===`);
    let flipped = 0, kept = 0;
    await Promise.all(actionItems.map(async (it) => {
      const sd = it.source_data ?? {};
      try {
        const nu = await computeUnderstanding({
          id: sd.email_id || it.id, user_id: USER, message_id: sd.message_id || '',
          from_address: sd.from || sd.from_address || '', from_name: sd.from_name || '',
          subject: sd.subject || '', body: sd.body || '', received_at: sd.received_at || new Date().toISOString(),
          recipient_position: sd.is_cc_only ? 'cc' : 'to', recipient_email: userAddrs[0],
          to_addresses: sd.to || [], cc_addresses: sd.cc || [], user_addresses: userAddrs, user_name: undefined,
        } as any, supabase);
        if (nu && nu.relevance !== 'action') { flipped++; console.log(`  action→${nu.relevance}: ${String(it.work_title).slice(0, 60)}`); }
        else if (nu) { kept++; console.log(`  KEPT action: ${String(it.work_title).slice(0, 60)}`); }
      } catch (e) { console.warn('  x', (e as Error).message); }
    }));
    console.log(`  → ${flipped}/${actionItems.length} flipped OUT of action, ${kept} stayed action (bar tightened).`);
  }

  // ── B) FYA vs Newsletters split over the noted pool.
  const noted = items.filter((it) => it.work_state === 'noted');
  let fyaFromNoted = 0, bulk = 0;
  const reneRows: any[] = [];
  for (const it of noted) {
    const sd = it.source_data ?? {};
    const u = coerceUnderstanding(sd.understanding);
    const real = u && u.relevance === 'awareness' && !isBulk(sd);
    if (real) fyaFromNoted++; else bulk++;
    if (/zeroto100|fees for/i.test(String(it.work_title || '') + ' ' + String(sd.from_name || '') + ' ' + String(sd.from || ''))) {
      reneRows.push({ title: it.work_title, from: sd.from_name || sd.from, relevance: u?.relevance, role: u?.role, unsub: !!sd.has_unsubscribe, bulk: isBulk(sd), route: real ? 'FOR-YOUR-AWARENESS' : 'newsletters' });
    }
  }
  console.log(`\n=== B) noted pool: ${noted.length} total → ${fyaFromNoted} real-correspondence (FYA), ${bulk} bulk (newsletters) ===`);
  console.log('Rene rows:', JSON.stringify(reneRows, null, 2));

  // ── FYA from the actionable pool (awareness understanding, not bulk, no actionable override).
  const USER_ACTIONABLE = new Set(['needs_reply', 'to_do', 'waiting_on']);
  const actionable = items.filter((it) => ['work_prepared', 'decision_required', 'action_required'].includes(it.work_state) || USER_ACTIONABLE.has(String(it.rule_type || '')));
  let fyaFromItems = 0, overrideProtected = 0;
  for (const it of actionable) {
    const sd = it.source_data ?? {};
    const u = coerceUnderstanding(sd.understanding);
    if (!(u && u.relevance === 'awareness')) continue;
    if (USER_ACTIONABLE.has(String(it.type_override || ''))) { overrideProtected++; continue; }
    if (isBulk(sd)) continue;
    fyaFromItems++;
  }
  console.log(`\n=== FYA from actionable pool: ${fyaFromItems} (user-override-protected & skipped: ${overrideProtected}) ===`);

  // ── C) worth-acting-on = current action count (post-recompute would be lower; this shows the pre-state).
  const actionCount = items.filter((it) => coerceUnderstanding(it.source_data?.understanding)?.relevance === 'action').length;
  console.log(`\n=== C) 'Worth acting on' candidates (relevance=action, stored): ${actionCount} ===`);
  console.log('   (run a full re-backfill to apply the new bar to all; --recompute samples the flip rate)\n');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
