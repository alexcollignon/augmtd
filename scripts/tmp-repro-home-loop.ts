// TEMPORARY (untracked): reproduce the sovereign-Home redirect loop.
// Mints a real session for an AHK (features.email=false) TEST member, injects cookies
// into headless Chrome, loads /home, and counts document/RSC requests.
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { chromium } from 'playwright-core';
dotenv.config({ path: '.env.local' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sb = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const projectRef = URL.replace('https://', '').split('.')[0];

(async () => {
  const { data: co } = await sb.from('companies').select('id,name,features').eq('slug', 'ahk-portugal').single();
  console.log('workspace:', co!.name, JSON.stringify((co as any).features));

  const { data: members } = await sb.from('company_members').select('user_id,role,status').eq('company_id', co!.id);
  const ids = (members || []).map((m) => m.user_id);
  const { data: profs } = await sb.from('profiles').select('id,email,full_name').in('id', ids);
  console.log('members:');
  for (const p of profs || []) console.log('  ', p.email, '|', p.full_name);

  // TEST accounts only — the workshop seeded users are user.ahk@... style.
  const target = (profs || []).find((p) => /user\.ahk@|@company\.com|test/i.test(p.email || ''));
  if (!target) { console.log('NO TEST MEMBER FOUND — aborting'); return; }
  console.log('using TEST member:', target.email);

  const { data: link, error: linkErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email: target.email! });
  if (linkErr) throw linkErr;
  const hashed = (link as any).properties.hashed_token;
  const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: ver, error: verErr } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (verErr) throw verErr;
  const s = ver.session!;

  const cookieValue = 'base64-' + Buffer.from(JSON.stringify({
    access_token: s.access_token, token_type: 'bearer', expires_in: s.expires_in,
    expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user,
  })).toString('utf8').length ? 'base64-' + Buffer.from(JSON.stringify({
    access_token: s.access_token, token_type: 'bearer', expires_in: s.expires_in,
    expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user,
  })).toString('base64') : '';

  const name = `sb-${projectRef}-auth-token`;
  // chunk into .0/.1 like supabase-js does for >3180 chars
  const cookies: any[] = [];
  if (cookieValue.length > 3180) {
    for (let i = 0, n = 0; i < cookieValue.length; i += 3180, n++)
      cookies.push({ name: `${name}.${n}`, value: cookieValue.slice(i, i + 3180), domain: 'localhost', path: '/' });
  } else {
    cookies.push({ name, value: cookieValue, domain: 'localhost', path: '/' });
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  const docs: string[] = [];
  const consoleMsgs: string[] = [];
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/home') || u.includes('_rsc')) docs.push(`${r.method()} ${u.replace('http://localhost:3000','')}`);
  });

  await page.goto('http://localhost:3000/home', { waitUntil: 'domcontentloaded' }).catch((e) => console.log('goto:', e.message));
  const t0 = docs.length;
  await new Promise((r) => setTimeout(r, 20000));
  console.log('\n=== /home-ish document/RSC requests in 20s after load:', docs.length - t0, '(total', docs.length + ')');
  console.log(docs.slice(0, 12).join('\n'));
  console.log('...');
  console.log('\n=== final URL:', page.url());
  const body = await page.evaluate(() => document.body.innerText).catch(() => '(no body)');
  console.log('=== body text (first 600):\n', body.slice(0, 600));
  const html = await page.content().catch(() => '');
  console.log('=== has main content?', /home-view|Private environment/.test(html), 'len', html.length);
  console.log('\n=== console:\n', consoleMsgs.slice(0, 25).join('\n'));

  await browser.close();
})();
