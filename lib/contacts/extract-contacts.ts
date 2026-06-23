import { SupabaseClient } from '@supabase/supabase-js'

interface EmailRow {
  from_address: string
  from_name: string | null
  to_addresses: string[] | null
  cc_addresses: string[] | null
  received_at: string | null
}

/**
 * Extracts unique contacts from a batch of emails and upserts them into
 * relationship_graph. Increments interaction_frequency rather than overwriting.
 * Non-fatal — caller should wrap in try/catch if needed.
 */
export async function upsertContacts(params: {
  userId: string
  /** The user's own email address — excluded from contacts */
  userEmail: string
  emails: EmailRow[]
  adminSupabase: SupabaseClient
}): Promise<void> {
  const { userId, userEmail, emails, adminSupabase } = params
  const selfEmail = userEmail.toLowerCase().trim()

  // Build a map of contact_email → { name, count, last_interaction }
  const contactMap = new Map<string, { contact_name: string | null; count: number; last_interaction: string | null }>()

  function add(email: string, name: string | null, date: string | null) {
    const key = email.toLowerCase().trim()
    if (!key || !key.includes('@') || key === selfEmail) return
    const existing = contactMap.get(key)
    if (existing) {
      existing.count++
      if (date && (!existing.last_interaction || date > existing.last_interaction)) {
        existing.last_interaction = date
      }
      if (!existing.contact_name && name) existing.contact_name = name
    } else {
      contactMap.set(key, { contact_name: name || null, count: 1, last_interaction: date })
    }
  }

  for (const email of emails) {
    add(email.from_address, email.from_name, email.received_at)
    for (const addr of email.to_addresses ?? []) add(addr, null, email.received_at)
    for (const addr of email.cc_addresses ?? []) add(addr, null, email.received_at)
  }

  if (contactMap.size === 0) return

  const contactEmails = Array.from(contactMap.keys())

  // Fetch existing rows so we can increment frequency (not overwrite)
  const { data: existing } = await adminSupabase
    .from('relationship_graph')
    .select('contact_email, interaction_frequency, contact_name')
    .eq('user_id', userId)
    .in('contact_email', contactEmails)

  const existingMap = new Map<string, { frequency: number; name: string | null }>()
  for (const row of existing ?? []) {
    existingMap.set(row.contact_email, {
      frequency: row.interaction_frequency ?? 0,
      name: row.contact_name ?? null,
    })
  }

  // Automated senders (no-reply, notifications, mailer-daemon, newsletters…) get a low,
  // capped importance — they're built from RECEIVED mail, so without this a frequent newsletter
  // would read as a VIP. Real people keep the frequency-based score.
  const AUTOMATED = /^(no-?reply|donotreply|do-not-reply|mailer-?daemon|bounce|postmaster|notifications?|notify|automated|alerts?|newsletter|updates?|mailer|noreply)([.\-_+]|$)/i

  const records = Array.from(contactMap.entries()).map(([email, c]) => {
    const prev = existingMap.get(email)
    const totalFrequency = (prev?.frequency ?? 0) + c.count
    const isAutomated = AUTOMATED.test(email.split('@')[0] || '')
    return {
      user_id: userId,
      contact_email: email,
      contact_name: c.contact_name || prev?.name || null,
      interaction_frequency: totalFrequency,
      importance: isAutomated ? 10 : Math.min(50 + totalFrequency * 5, 100),
      last_interaction: c.last_interaction,
      updated_at: new Date().toISOString(),
    }
  })

  // Upsert in batches of 100
  const BATCH = 100
  for (let i = 0; i < records.length; i += BATCH) {
    await adminSupabase
      .from('relationship_graph')
      .upsert(records.slice(i, i + BATCH), { onConflict: 'user_id,contact_email' })
  }
}
