// Read a user's email-handling preferences (the Email tab toggles). Server-side; tolerant of the
// column not existing yet (degrades to defaults).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

export type EmailSettings = {
  auto_draft: boolean;
  auto_label: boolean;
  cc_bcc_new: boolean;
  todo_auto: boolean;
  todo_internal: boolean;
  todo_others: boolean;
  todo_instructions: string;
};

export const EMAIL_SETTINGS_DEFAULTS: EmailSettings = {
  auto_draft: true,
  // W10 THE MAILBOX IS THE USER'S (owner call, Sep 23): AUGMTD's own mailbox labels are OFF unless
  // the account explicitly chose them (auto_label === true). Unset → off. Governs AUGMTD's POSTURE
  // labels only — a user rule's own label/deeds apply regardless (lib/inbox/rules/label-name.ts).
  auto_label: false,
  cc_bcc_new: false,
  todo_auto: true,
  todo_internal: false,
  todo_others: false,
  todo_instructions: '',
};

export async function getEmailSettings(userId: string, client: DBClient): Promise<EmailSettings> {
  try {
    const { data } = await client.from('profiles').select('email_settings').eq('id', userId).maybeSingle();
    return { ...EMAIL_SETTINGS_DEFAULTS, ...((data?.email_settings as Partial<EmailSettings>) ?? {}) };
  } catch {
    return { ...EMAIL_SETTINGS_DEFAULTS };
  }
}
