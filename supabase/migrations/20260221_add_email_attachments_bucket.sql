-- Create the email-attachments storage bucket (private, not public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-attachments',
  'email-attachments',
  false,
  10485760, -- 10 MB limit per file
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword', 'text/plain', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: users can only read their own attachments (path starts with their user_id)
CREATE POLICY "Users read own attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
