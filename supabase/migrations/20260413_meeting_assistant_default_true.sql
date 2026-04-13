-- Meeting assistant is now on by default for all new users.
-- Super admins control activation — users can no longer toggle it themselves.
ALTER TABLE profiles ALTER COLUMN attendee_enabled SET DEFAULT true;
