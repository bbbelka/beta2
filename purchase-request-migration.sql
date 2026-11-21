-- Apply after supabase-schema.sql and messages-migration.sql.
-- Local migration draft only. Do not apply without reviewing the target project.
begin;

do $$
begin
  if to_regclass('public.products') is null
      or to_regclass('public.orders') is null
      or to_regclass('public.conversations') is null
      or to_regclass('public.messages') is null then
    raise exception 'Apply supabase-schema.sql and messages-migration.sql before purchase-request-migration.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Required function public.is_admin() is missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'available'
      and data_type = 'boolean'
  ) then
    raise exception 'Required boolean column public.products.available is missing';
  end if;
end;
$$;

alter table public.orders
  add column if not exists request_number text,
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists idempotency_key uuid;

create unique index if not exists orders_request_number_uidx
  on public.orders(request_number)
  where request_number is not null;
create unique index if not exists orders_user_idempotency_uidx
  on public.orders(user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists orders_conversation_idx
  on public.orders(conversation_id)
  where conversation_id is not null;

alter table public.messages
  add column if not exists message_type text not null default 'user',
  add column if not exists purchase_request_id bigint references public.orders(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_message_type_check'
  ) then
    alter table public.messages
      add constraint messages_message_type_check
      check (message_type in ('user', 'purchase_request'));
  end if;
end;
$$;

create unique index if not exists messages_purchase_request_uidx
  on public.messages(purchase_request_id)
  where purchase_request_id is not null;

alter table public.orders enable row level security;
drop policy if exists "Customers read own orders" on public.orders;
create policy "Customers read own orders" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "Customers create own orders" on public.orders;
revoke all on public.orders from public, anon, authenticated;
grant select on public.orders to authenticated;

-- Clients may create ordinary chat messages, but cannot forge request notices or links.
revoke all on public.messages from public, anon, authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, body, attachment_path, attachment_type)
  on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

create or replace function public.purchase_request_price_amount(p_price text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_price text;
  v_amount numeric;
begin
  if p_price is null then
    raise exception 'У товара не указана цена';
  end if;

  v_price := regexp_replace(
    replace(replace(btrim(p_price), chr(160), ' '), chr(8239), ' '),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_price := regexp_replace(v_price, '[[:space:]]*(₽|руб\.?)$', '', 'i');
  if v_price !~ '^([0-9]+|[0-9]{1,3}( [0-9]{3})+)([,.][0-9]{1,2})?$' then
    raise exception 'У товара указана некорректная цена';
  end if;

  v_amount := replace(replace(v_price, ' ', ''), ',', '.')::numeric;
  if v_amount <= 0 then
    raise exception 'Цена товара должна быть больше нуля';
  end if;
  return v_amount;
end;
$$;
revoke all on function public.purchase_request_price_amount(text) from public, anon, authenticated;

create or replace function public.create_purchase_request(
  p_items jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_customer_email text;
  v_customer_name text;
  v_item_count integer;
  v_distinct_count integer;
  v_valid_count integer;
  v_product_ids bigint[];
  v_request_items jsonb;
  v_saved_request_items jsonb;
  v_order_items jsonb;
  v_item_summary text;
  v_message_body text;
  v_total numeric;
  v_first_product_id bigint;
  v_conversation_id uuid;
  v_order_id bigint;
  v_request_number text;
  v_created_at timestamptz;
  v_existing_order record;
begin
  if v_user_id is null then
    raise exception 'Для оформления заявки войдите в аккаунт';
  end if;
  if p_idempotency_key is null then
    raise exception 'Не указан идентификатор заявки';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Список товаров должен быть массивом';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 100 then
    raise exception 'В заявке должно быть от 1 до 100 товаров';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or jsonb_typeof(entry.value -> 'product_id') <> 'number'
      or coalesce(entry.value ->> 'product_id', '') !~ '^[1-9][0-9]*$'
      or case
        when jsonb_typeof(entry.value -> 'product_id') = 'number'
          and coalesce(entry.value ->> 'product_id', '') ~ '^[1-9][0-9]*$'
          and char_length(entry.value ->> 'product_id') <= 19
        then (entry.value ->> 'product_id')::numeric > 9223372036854775807
        else true
      end
      or jsonb_typeof(entry.value -> 'quantity') <> 'number'
      or coalesce(entry.value ->> 'quantity', '') !~ '^[1-9][0-9]*$'
      or case
        when jsonb_typeof(entry.value -> 'quantity') = 'number'
          and coalesce(entry.value ->> 'quantity', '') ~ '^[1-9][0-9]*$'
          and char_length(entry.value ->> 'quantity') <= 10
        then (entry.value ->> 'quantity')::numeric > 2147483647
        else true
      end
  ) then
    raise exception 'Для каждого товара укажите положительное целое количество';
  end if;

  select count(*)::integer,
         count(distinct line.product_id)::integer,
         array_agg(line.product_id order by line.product_id)
  into v_item_count, v_distinct_count, v_product_ids
  from jsonb_to_recordset(p_items) as line(product_id bigint, quantity integer);
  if v_item_count <> v_distinct_count then
    raise exception 'Один товар не должен повторяться в списке заявки';
  end if;

  select jsonb_agg(
    jsonb_build_object('product_id', line.product_id, 'quantity', line.quantity)
    order by line.product_id
  )
  into v_request_items
  from jsonb_to_recordset(p_items) as line(product_id bigint, quantity integer);

  -- Serialize a buyer's requests so retries and concurrent submissions share one result.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select id, request_number, conversation_id, items, total, created_at
  into v_existing_order
  from public.orders
  where user_id = v_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    select jsonb_agg(
      jsonb_build_object(
        'product_id', (entry.value ->> 'product_id')::bigint,
        'quantity', (entry.value ->> 'quantity')::integer
      )
      order by (entry.value ->> 'product_id')::bigint
    )
    into v_saved_request_items
    from jsonb_array_elements(v_existing_order.items) as entry(value);
    if v_saved_request_items is distinct from v_request_items then
      raise exception 'Этот ключ уже использован для другой заявки';
    end if;
    return jsonb_build_object(
      'id', v_existing_order.id,
      'request_number', v_existing_order.request_number,
      'conversation_id', v_existing_order.conversation_id,
      'items', v_existing_order.items,
      'total', v_existing_order.total,
      'created_at', v_existing_order.created_at
    );
  end if;

  perform product.id
  from public.products as product
  where product.id = any(v_product_ids)
  order by product.id
  for update;

  select count(*)::integer
  into v_valid_count
  from jsonb_to_recordset(v_request_items) as line(product_id bigint, quantity integer)
  join public.products as product on product.id = line.product_id
  where product.available is true;
  if v_valid_count <> v_item_count then
    raise exception 'Один или несколько товаров больше не доступны';
  end if;

  select coalesce(sum(price.amount * line.quantity), 0),
         jsonb_agg(
           jsonb_build_object(
             'product_id', product.id,
             'avito_id', product.avito_id,
             'name', product.name,
             'image', coalesce(product.image, ''),
             'photos', coalesce(product.photos, '[]'::jsonb),
             'link', coalesce(product.link, ''),
             'price', product.price,
             'unit_price', price.amount,
             'quantity', line.quantity,
             'line_total', price.amount * line.quantity
           )
           order by product.id
         ),
         array_agg(product.id order by product.id)
  into v_total, v_order_items, v_product_ids
  from jsonb_to_recordset(v_request_items) as line(product_id bigint, quantity integer)
  join public.products as product on product.id = line.product_id
  cross join lateral (
    select public.purchase_request_price_amount(product.price) as amount
  ) as price;
  if v_total is null or v_total <= 0 or v_order_items is null then
    raise exception 'Не удалось рассчитать стоимость заявки';
  end if;
  v_first_product_id := v_product_ids[1];

  v_customer_email := nullif(v_claims ->> 'email', '');
  v_customer_name := coalesce(
    nullif(v_claims -> 'user_metadata' ->> 'display_name', ''),
    nullif(v_claims -> 'user_metadata' ->> 'full_name', ''),
    v_customer_email,
    'Покупатель'
  );
  v_created_at := clock_timestamp();

  select conversation.id
  into v_conversation_id
  from public.conversations as conversation
  where conversation.customer_id = v_user_id
  order by conversation.last_message_at desc, conversation.created_at desc
  limit 1
  for update;
  if v_conversation_id is null then
    insert into public.conversations (
      customer_id, product_id, product_name, product_price, customer_name, subject,
      created_at, last_message_at
    )
    values (
      v_user_id, v_first_product_id, 'Заявка на приобретение', '',
      v_customer_name, 'Заявка на приобретение', v_created_at, v_created_at
    )
    returning id into v_conversation_id;
  else
    update public.conversations
    set customer_name = coalesce(nullif(customer_name, ''), v_customer_name),
        last_message_at = v_created_at
    where id = v_conversation_id;
  end if;

  insert into public.orders (
    user_id, items, customer, address, delivery, total, status,
    conversation_id, idempotency_key, created_at, updated_at
  )
  values (
    v_user_id,
    v_order_items,
    jsonb_build_object('name', v_customer_name, 'email', v_customer_email),
    '{}'::jsonb,
    '{}'::jsonb,
    v_total,
    'ordered',
    v_conversation_id,
    p_idempotency_key,
    v_created_at,
    v_created_at
  )
  returning id into v_order_id;

  v_request_number := format(
    'MDA-%s-%s',
    to_char(v_created_at, 'YYYY'),
    lpad(v_order_id::text, greatest(6, char_length(v_order_id::text)), '0')
  );
  update public.orders
  set request_number = v_request_number
  where id = v_order_id;

  select string_agg(
    format(
      '%s. %s — %s × %s = %s',
      entry.ordinality,
      entry.value ->> 'name',
      entry.value ->> 'price',
      entry.value ->> 'quantity',
      (entry.value ->> 'line_total')::numeric
    ),
    E'\n'
    order by entry.ordinality
  )
  into v_item_summary
  from jsonb_array_elements(v_order_items) with ordinality as entry(value, ordinality);

  v_message_body := format(
    E'Новая заявка на покупку\nЗаявка № %s\n\n%s\n\nОбщая сумма заявки: %s ₽\nДата оформления: %s\nЗаявка сохранена в разделе «Заказы».',
    v_request_number,
    left(coalesce(v_item_summary, ''), 3000),
    v_total,
    to_char(v_created_at, 'DD.MM.YYYY HH24:MI')
  );
  insert into public.messages (
    conversation_id, sender_id, body, message_type, purchase_request_id, created_at
  )
  values (
    v_conversation_id, v_user_id, left(v_message_body, 3900),
    'purchase_request', v_order_id, v_created_at
  );

  return jsonb_build_object(
    'id', v_order_id,
    'request_number', v_request_number,
    'conversation_id', v_conversation_id,
    'items', v_order_items,
    'total', v_total,
    'created_at', v_created_at
  );
end;
$$;
revoke all on function public.create_purchase_request(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_purchase_request(jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
