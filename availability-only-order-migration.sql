-- Local-only migration draft. Do not apply without reviewing and approving the
-- availability-only purchase flow for the target Supabase project.
begin;

do $$
declare
  v_arg_names text[];
  v_return_type oid;
begin
  if to_regclass('public.products') is null
      or to_regclass('public.orders') is null
      or to_regclass('public.shop_order_idempotency') is null then
    raise exception 'Не найдены таблицы каталога, заказов или идемпотентности';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'available'
      and data_type = 'boolean'
  ) then
    raise exception 'Колонка public.products.available типа boolean не найдена';
  end if;
  if to_regprocedure('public.is_admin()') is null
      or to_regprocedure('public.product_price_amount(text)') is null then
    raise exception 'Не найдены ожидаемые функции схемы; проверьте inventory-migration.sql';
  end if;

  select proargnames, prorettype
  into v_arg_names, v_return_type
  from pg_proc
  where oid = to_regprocedure('public.create_shop_order(jsonb,jsonb,jsonb,jsonb,uuid)');

  if v_arg_names is not null
      and v_arg_names is distinct from array[
        'p_items', 'p_customer', 'p_address', 'p_delivery', 'p_idempotency_key'
      ]::text[] then
    raise exception 'Существующая create_shop_order имеет другие имена аргументов (%); требуется отдельный анализ',
      v_arg_names;
  end if;
  if v_return_type is not null and v_return_type <> 'jsonb'::regtype then
    raise exception 'Существующая create_shop_order имеет несовместимый тип результата (%); требуется отдельный анализ',
      v_return_type::regtype;
  end if;
end;
$$;

-- Keep the existing trigger binding, but let the manually-managed available
-- column remain authoritative instead of deriving it from the legacy quantity.
create or replace function public.sync_product_availability_from_stock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.available := coalesce(new.available, true);
  return new;
end;
$$;

create or replace function public.create_shop_order(
  p_items jsonb,
  p_customer jsonb,
  p_address jsonb,
  p_delivery jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item_count integer;
  v_distinct_count integer;
  v_valid_count integer;
  v_product_ids bigint[];
  v_items jsonb;
  v_order_items jsonb;
  v_request_payload jsonb;
  v_saved_payload jsonb;
  v_order_id bigint;
  v_existing_order_id bigint;
  v_result jsonb;
  v_subtotal numeric;
  v_delivery_type text;
  v_delivery_company text;
  v_delivery_price numeric;
  v_is_local boolean;
  v_total numeric;
begin
  if v_user_id is null then
    raise exception 'Для оформления заказа войдите в аккаунт';
  end if;
  if p_idempotency_key is null then
    raise exception 'Не указан идентификатор запроса заказа';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Корзина пуста';
  end if;
  if jsonb_typeof(coalesce(p_customer, '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_address, '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_delivery, '{}'::jsonb)) <> 'object' then
    raise exception 'Некорректные данные заказа';
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
    raise exception 'Один товар не должен повторяться в списке заказа';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', line.product_id, 'quantity', line.quantity)
                   order by line.product_id)
  into v_items
  from jsonb_to_recordset(p_items) as line(product_id bigint, quantity integer);

  v_delivery_type := p_delivery ->> 'type';
  v_is_local := lower(concat_ws(' ', p_address ->> 'region', p_address ->> 'city'))
    ~ '(спб|ленинград|санкт)';
  case v_delivery_type
    when 'ozon' then
      v_delivery_company := 'Ozon';
      v_delivery_price := case when v_is_local then 299 else 450 end;
    when 'post' then
      v_delivery_company := 'Почта России';
      v_delivery_price := case when v_is_local then 250 else 350 end;
    when 'yandex' then
      v_delivery_company := 'Яндекс Маркет';
      v_delivery_price := case when v_is_local then 280 else 400 end;
    when 'cdek' then
      v_delivery_company := 'СДЭК';
      v_delivery_price := case when v_is_local then 350 else 550 end;
    else
      raise exception 'Выберите доступный способ доставки';
  end case;

  v_request_payload := jsonb_build_object(
    'items', v_items,
    'customer', coalesce(p_customer, '{}'::jsonb),
    'address', coalesce(p_address, '{}'::jsonb),
    'delivery_type', v_delivery_type
  );
  insert into public.shop_order_idempotency(user_id, idempotency_key, request_payload)
  values (v_user_id, p_idempotency_key, v_request_payload)
  on conflict (user_id, idempotency_key) do nothing;
  select request_payload, order_id
  into v_saved_payload, v_existing_order_id
  from public.shop_order_idempotency
  where user_id = v_user_id and idempotency_key = p_idempotency_key
  for update;
  if v_saved_payload is distinct from v_request_payload then
    raise exception 'Этот запрос уже использован для другого содержимого заказа';
  end if;
  if v_existing_order_id is not null then
    select jsonb_build_object('id', id, 'items', items, 'total', total, 'delivery', delivery)
    into v_result
    from public.orders
    where id = v_existing_order_id and user_id = v_user_id;
    if v_result is null then
      raise exception 'Не удалось восстановить результат ранее созданного заказа';
    end if;
    return v_result;
  end if;

  perform product.id
  from public.products as product
  where product.id = any(v_product_ids)
  order by product.id
  for update;

  select count(*)::integer
  into v_valid_count
  from jsonb_to_recordset(v_items) as line(product_id bigint, quantity integer)
  join public.products as product on product.id = line.product_id
  where product.available is true;
  if v_valid_count <> v_item_count then
    raise exception 'Один или несколько товаров больше не доступны для заказа';
  end if;

  select coalesce(sum(public.product_price_amount(product.price) * line.quantity), 0),
         jsonb_agg(jsonb_build_object(
           'product_id', product.id,
           'avitoId', coalesce(product.avito_id, product.id::text),
           'name', product.name,
           'price', product.price,
           'quantity', line.quantity
         ) order by product.id)
  into v_subtotal, v_order_items
  from jsonb_to_recordset(v_items) as line(product_id bigint, quantity integer)
  join public.products as product on product.id = line.product_id;
  if v_subtotal is null or v_subtotal <= 0 then
    raise exception 'Заказ содержит товар без корректной положительной цены';
  end if;
  v_total := v_subtotal + v_delivery_price;
  if v_total <= 0 then
    raise exception 'Итоговая сумма заказа должна быть больше нуля';
  end if;

  insert into public.orders(user_id, items, customer, address, delivery, total, status)
  values (
    v_user_id, v_order_items, coalesce(p_customer, '{}'::jsonb), coalesce(p_address, '{}'::jsonb),
    (coalesce(p_delivery, '{}'::jsonb) - 'company' - 'price')
      || jsonb_build_object('type', v_delivery_type, 'company', v_delivery_company, 'price', v_delivery_price),
    v_total, 'ordered'
  )
  returning id into v_order_id;

  update public.shop_order_idempotency
  set order_id = v_order_id
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  select jsonb_build_object('id', id, 'items', items, 'total', total, 'delivery', delivery)
  into v_result
  from public.orders
  where id = v_order_id and user_id = v_user_id;
  return v_result;
end;
$$;
revoke all on function public.create_shop_order(jsonb, jsonb, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_shop_order(jsonb, jsonb, jsonb, jsonb, uuid)
  to authenticated;

create or replace function public.update_shop_order_status(
  p_order_id bigint,
  p_status text,
  p_tracking_number text default '',
  p_status_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_status text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Управлять заказами могут только администраторы';
  end if;
  if p_order_id is null or p_status is null or p_status not in (
    'ordered', 'sent', 'at_warehouse', 'ready_for_pickup', 'delivered', 'cancelled'
  ) then
    raise exception 'Некорректный статус заказа';
  end if;

  select status
  into v_current_status
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Заказ не найден';
  end if;
  if v_current_status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'Отменённый заказ нельзя возобновить через смену статуса';
  end if;
  if p_status = 'cancelled' and v_current_status <> 'cancelled'
      and v_current_status <> 'ordered' then
    raise exception 'Автоматическая отмена доступна только до отправки заказа';
  end if;

  update public.orders
  set status = p_status,
      tracking_number = coalesce(p_tracking_number, ''),
      status_note = coalesce(p_status_note, ''),
      updated_at = now()
  where id = p_order_id;
end;
$$;
revoke all on function public.update_shop_order_status(bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_shop_order_status(bigint, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
