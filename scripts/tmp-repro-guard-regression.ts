// TEMPORARY (untracked): the guard still gates, and a normal workspace is untouched.
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { chromium } from 'playwright-core';
dotenv.config({ path: '.env.local' });
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ref = SB_URL.replace('https://', '').split('.')[0];

async function cookiesFor(email: string) {
  const { data: link } = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  const anon = createClient(SB_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: ver, error } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: (link as any).properties.hashed_token });
  if (error) throw error;
  const s = ver.session!;
  const v = 'base64-' + Buffer.from(JSON.stringify({
    access_token: s.access_token, token_type: 'bearer', expires_in: s.expires_in,
    expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user,
  })).toString('base64');
  const n = `sb-${ref}-auth-token`;
  const out: any[] = [];
  if (v.length > 3180) for (let i = 0, k = 0; i < v.length; i += 3180, k++) out.push({ name: `${n}.${k}`, value: v.slice(i, i + 3180), domain: 'localhost', path: '/' });
  else out.push({ name: n, value: v, domain: 'localhost', path: '/' });
  return out;
}

async function visit(browser: any, email: string, path: string, label: string) {
  const ctx = await browser.newContext();
  await ctx.addCookies(await cookiesFor(email));
  const page = await ctx.newPage();
  let docs = 0;
  page.on('request', (r: any) => { if (r.url().replace('http://localhost:3000','').split('?')[0] === path) docs++; });
  await page.goto('http://localhost:3000' + path, { waitUntil: 'domcontentloaded' }).catch((e: any) => console.log('  goto err:', e.message.split('\n')[0]));
  await new Promise((r) => setTimeout(r, 4000));
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  console.log(`\n[${label}] ${email} → ${path}`);
  console.log(`  final URL : ${page.url()}`);
  console.log(`  ${path} document requests: ${docs}`);
  console.log(`  body head : ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  await ctx.close();
}

(async () => {
  const { resolveProbeUser } = await import('./probe-user');
  const uid = await resolveProbeUser(sb);
  const { data: prof } = await sb.from('profiles').select('email').eq('id', uid).single();

  // A TEMPORARY normal workspace (email on, `home` unset — the default shape) so the probe
  // user exercises the untouched code path. Torn down at the end.
  const slug = 'tmp-guard-regression';
  await sb.from('companies').delete().eq('slug', slug);
  const { data: co, error: coErr } = await sb.from('companies').insert({
    name: 'Tmp Guard Regression', slug, join_code: 'TMPGUARD1',
    features: { email: true, meetings: false, drive: true, agents: true, studio: true },
    status: 'active',
  }).select('id,features').single();
  if (coErr) throw coErr;
  const { data: priorMem } = await sb.from('company_members').select('company_id').eq('user_id', uid);
  await sb.from('company_members').insert({ company_id: co!.id, user_id: uid, role: 'member', status: 'active' });
  console.log('temp normal workspace:', JSON.stringify(co!.features), '→', prof!.email);
  console.log('probe user prior memberships:', (priorMem||[]).length);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // 1) The gate still FIRES: AHK has email:false, so /inbox must still bounce to /home.
    await visit(browser, 'user.ahk@company.com', '/inbox', 'GATE STILL FIRES (email:false)');
    // 2) A normal workspace's Home is untouched.
    await visit(browser, prof!.email!, '/home', 'NORMAL WORKSPACE HOME');
  } finally {
    await browser.close();
    await sb.from('company_members').delete().eq('company_id', co!.id).eq('user_id', uid);
    await sb.from('companies').delete().eq('id', co!.id);
    console.log('\ncleanup: temp workspace + membership removed');
  }
})();
