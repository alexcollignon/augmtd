// TEMP — provision a confirmed UI-walk test user on the workshop workspace. Never committed.
// --clean deletes it fully.
import { createClient } from '@supabase/supabase-js';

const EMAIL = 'ui-walk@augmtd-internal.test';
const PASSWORD = 'UiWalk-2026-Smoke!';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = data?.users?.find(u => u.email === EMAIL);
  if (process.argv.includes('--clean')) {
    if (existing) {
      const { deleteUserFully } = await import('../lib/workspace/cascade-delete');
      await deleteUserFully(sb, existing.id);
      console.log('deleted');
    } else console.log('nothing to delete');
    return;
  }
  let uid = existing?.id;
  if (!uid) {
    const { data: created, error } = await sb.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !created?.user) { console.error(error?.message); process.exit(1); }
    uid = created.user.id;
  } else {
    await sb.auth.admin.updateUserById(uid, { password: PASSWORD });
  }
  await sb.from('profiles').upsert({ id: uid, email: EMAIL, full_name: 'Walk Tester', needs_join: false }, { onConflict: 'id' });
  const { data: co } = await sb.from('companies').select('id').eq('slug', 'emirates-nbd').maybeSingle();
  await sb.from('company_members').upsert({ company_id: co!.id, user_id: uid, role: 'member', status: 'active' }, { onConflict: 'company_id,user_id' });
  const { ensureWorkers } = await import('../lib/workers/seed');
  await ensureWorkers(sb, uid);
  const { seedKnowledgeForUser } = await import('../lib/workspace/seed-kb');
  const r = await seedKnowledgeForUser(sb, co!.id, uid);
  console.log('user ready:', uid.slice(0, 8), '| kit:', JSON.stringify(r));
}
main().catch((e) => { console.error(e); process.exit(1); });
