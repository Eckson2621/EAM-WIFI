-- EAM-WIFI chat attachments and live message delivery.
-- Run against the EAM-WIFI Supabase project. Existing participant RLS and
-- private Storage bucket policies remain the access-control boundary.

alter table public.chat_messages
  add column if not exists attachment_name text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size_bytes bigint;

alter table public.chat_messages
  drop constraint if exists chat_messages_message_type_check,
  drop constraint if exists chat_message_content_check,
  drop constraint if exists chat_messages_attachment_metadata_check;

alter table public.chat_messages
  add constraint chat_messages_message_type_check
    check (message_type = any (array['text'::text,'image'::text,'file'::text,'system'::text])),
  add constraint chat_message_content_check
    check (
      (message_type = 'text' and body is not null and length(trim(body)) between 1 and 5000 and media_path is null
        and attachment_name is null and attachment_mime_type is null and attachment_size_bytes is null)
      or
      (message_type in ('image','file') and media_path is not null
        and (body is null or length(trim(body)) <= 1000)
        and attachment_name is not null and attachment_mime_type is not null
        and attachment_size_bytes between 1 and 15728640
        and ((message_type = 'image' and attachment_mime_type in ('image/jpeg','image/png','image/webp','image/gif'))
          or (message_type = 'file' and attachment_mime_type = 'application/pdf')))
      or
      (message_type = 'system' and body is not null and length(trim(body)) between 1 and 1000 and media_path is null
        and attachment_name is null and attachment_mime_type is null and attachment_size_bytes is null)
    ),
  add constraint chat_messages_attachment_metadata_check
    check (attachment_name is null or (length(attachment_name) between 1 and 255 and attachment_name !~ '[/\\\\]'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
