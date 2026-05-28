import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

export interface UserInboxCategory {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  color?: string;
}

async function getSettings(userId: string, supabase: any) {
  const { data } = await supabase.from('profiles').select('settings').eq('id', userId).single();
  return (data?.settings ?? {}) as Record<string, any>;
}

async function saveSettings(userId: string, settings: Record<string, any>, supabase: any) {
  await supabase.from('profiles').update({ settings }).eq('id', userId);
}

async function getCategories(userId: string, supabase: any): Promise<UserInboxCategory[]> {
  const settings = await getSettings(userId, supabase);
  return (settings.custom_inbox_categories as UserInboxCategory[]) ?? [];
}

async function saveCategories(userId: string, categories: UserInboxCategory[], supabase: any) {
  const settings = await getSettings(userId, supabase);
  await saveSettings(userId, { ...settings, custom_inbox_categories: categories }, supabase);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const settings = await getSettings(user.id, supabase);
  const categories = (settings.custom_inbox_categories as UserInboxCategory[]) ?? [];
  const sectionOrder = (settings.inbox_section_order as string[]) ?? [];
  return NextResponse.json({ categories, sectionOrder });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { name, description, emoji, color } = body as Partial<UserInboxCategory>;
  if (!name?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'name and description required' }, { status: 400 });
  }

  const categories = await getCategories(user.id, supabase);
  const newCategory: UserInboxCategory = {
    id: randomUUID(),
    name: name.trim(),
    description: description.trim(),
    ...(emoji ? { emoji } : {}),
    ...(color ? { color } : {}),
  };
  await saveCategories(user.id, [...categories, newCategory], supabase);
  return NextResponse.json({ category: newCategory });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();

  // Section order update (no id field)
  if (Array.isArray(body.sectionOrder)) {
    const settings = await getSettings(user.id, supabase);
    await saveSettings(user.id, { ...settings, inbox_section_order: body.sectionOrder }, supabase);
    return NextResponse.json({ ok: true });
  }

  const { id, name, description, emoji, color } = body as Partial<UserInboxCategory>;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const categories = await getCategories(user.id, supabase);
  const updated = categories.map(c =>
    c.id === id
      ? { ...c, ...(name ? { name: name.trim() } : {}), ...(description ? { description: description.trim() } : {}), ...(emoji !== undefined ? { emoji } : {}), ...(color !== undefined ? { color } : {}) }
      : c
  );
  await saveCategories(user.id, updated, supabase);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const categories = await getCategories(user.id, supabase);
  const deleted = categories.find(c => c.id === id);
  await saveCategories(user.id, categories.filter(c => c.id !== id), supabase);

  // Clear custom_category on any inbox items that had this category
  if (deleted?.name) {
    await supabase
      .from('inbox_items')
      .update({ custom_category: null })
      .eq('user_id', user.id)
      .eq('custom_category', deleted.name);
  }

  return NextResponse.json({ ok: true });
}
