-- Hiding a conversation only removes it from one user's inbox; messages and attachments remain intact.
create table if not exists public.conversation_user_hides (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists conversation_user_hides_conversation_idx
  on public.conversation_user_hides(conversation_id);

alter table public.conversation_user_hides enable row level security;

drop policy if exists "chat users read own hidden conversations" on public.conversation_user_hides;
create policy "chat users read own hidden conversations" on public.conversation_user_hides
for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_user_hides.conversation_id
      and (c.customer_id = auth.uid() or public.is_shop_admin())
  )
);

drop policy if exists "chat users hide allowed conversations" on public.conversation_user_hides;
create policy "chat users hide allowed conversations" on public.conversation_user_hides
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_user_hides.conversation_id
      and (c.customer_id = auth.uid() or public.is_shop_admin())
  )
);

drop policy if exists "chat users restore own conversations" on public.conversation_user_hides;
create policy "chat users restore own conversations" on public.conversation_user_hides
for delete to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_user_hides.conversation_id
      and (c.customer_id = auth.uid() or public.is_shop_admin())
  )
);

revoke all on public.conversation_user_hides from public, anon, authenticated;
grant select, insert, delete on public.conversation_user_hides to authenticated;
