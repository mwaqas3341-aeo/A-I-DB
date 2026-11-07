-- WhatsApp number + per-user WhatsApp service switch (applied live as migration "user_whatsapp")
alter table public.app_users
  add column if not exists whatsapp_no text,
  add column if not exists whatsapp_enabled boolean not null default false;
comment on column public.app_users.whatsapp_no is 'User WhatsApp number (as entered, e.g. 03XX-XXXXXXX or 923XXXXXXXXX)';
comment on column public.app_users.whatsapp_enabled is 'Admin-controlled: WhatsApp service (sending files / messages) enabled for this user';
alter table public.app_users drop constraint if exists app_users_whatsapp_chk;
alter table public.app_users add constraint app_users_whatsapp_chk
  check (whatsapp_enabled = false or nullif(btrim(coalesce(whatsapp_no,'')),'') is not null);
