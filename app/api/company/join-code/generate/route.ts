import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';
import { randomBytes } from 'crypto';

// Unambiguous 32-char alphabet — no I, O, 1, 0
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let code = '';
  while (code.length < 8) {
    const buf = randomBytes(16);
    for (const byte of buf) {
      if (code.length === 8) break;
      // Rejection sampling to avoid modulo bias (32 = 2^5, 256/32 = 8)
      if (byte < 256 - (256 % 32)) {
        code += CHARS[byte % 32];
      }
    }
  }
  return code;
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const code = generateCode();

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: updateErr } = await adminClient
    .from('companies')
    .update({ join_code: code })
    .eq('id', company.id);

  if (updateErr) return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 });

  return NextResponse.json({ code });
}
