-- Purpose: A frozen copy of db/schema.sql at schema version 2, so tests can prove that running the current schema on a version 2
-- database updates it without losing rows (tests/schema.test.js). Never edit it; it is the past.
-- Responsibilities: Create the businesses, members and documents tables, the last-write-wins trigger, the access rules by business
-- membership, and the functions that create or join a business. It must stay idempotent (safe to run any number of times) and never
-- delete rows: the app deletes by setting deleted_at.
--
-- Schema version 2 (version 2 added the readable v_* views at the end). Requires what Supabase provides: auth.uid() and the "authenticated" role (tests/helpers/postgres.js creates stand-ins).
-- Every device document is one row of public.documents, stored as it is in data (jsonb):
--   path               "orders/<uuid>", "notes/<uuid>", "products/<uuid>", ...
--   doc_date           the date used by the device's cache window (null = always kept)
--   client_updated_at  when the person made the change, on their device; the newer change wins
--   server_updated_at  when the row reached the server; devices pull changes after this point

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  business_id uuid not null references public.businesses (id),
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists public.documents (
  business_id uuid not null references public.businesses (id),
  path text not null check (length(path) between 3 and 300 and path ~ '^[a-z]+/[^/]+$'),
  collection text not null,
  doc_date date,
  data jsonb not null,
  deleted_at timestamptz,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, path)
);

create index if not exists documents_by_change on public.documents (business_id, server_updated_at);
create index if not exists documents_by_date on public.documents (business_id, collection, doc_date);

-- Is the signed-in person a member of this business? Security definer so the rules below do not recurse into members' own rule.
create or replace function public.notas_is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.business_id = b and m.user_id = auth.uid())
$$;

-- Last write wins: an update carrying an older client_updated_at than the stored row is skipped, so a change queued offline
-- cannot overwrite a newer one from another device. History entries are never changed once written.
create or replace function public.notas_touch() returns trigger
language plpgsql as $$
begin
  new.collection := split_part(new.path, '/', 1);
  if tg_op = 'UPDATE' then
    if new.client_updated_at < old.client_updated_at then
      return null;
    end if;
    if old.collection = 'history' then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before insert or update on public.documents for each row execute function public.notas_touch();

-- Access: only members of a business see and change its rows. There is no DELETE grant.
alter table public.businesses enable row level security;
alter table public.members enable row level security;
alter table public.documents enable row level security;

drop policy if exists businesses_read on public.businesses;
create policy businesses_read on public.businesses for select to authenticated using (public.notas_is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.notas_is_member(business_id));

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated using (public.notas_is_member(business_id));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated with check (public.notas_is_member(business_id));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.notas_is_member(business_id)) with check (public.notas_is_member(business_id));

revoke all on public.businesses, public.members, public.documents from anon;
grant select on public.businesses, public.members to authenticated;
grant select, insert, update on public.documents to authenticated;

-- A six-letter code people type to join a business (no I or O, which look like 1 and 0).
create or replace function public.notas_new_code() returns text
language plpgsql volatile as $$
declare
  letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    exit when not exists (select 1 from public.businesses where join_code = code);
  end loop;
  return code;
end
$$;

-- The caller's business, if any.
create or replace function public.notas_membership() returns table (business_id uuid, business_name text, join_code text, role text)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.join_code, m.role
  from public.members m join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1
$$;

-- First sign-in of the owner: creates the business and makes the caller its owner. Returns the existing one if there is one.
create or replace function public.notas_bootstrap(p_name text) returns table (business_id uuid, business_name text, join_code text, role text)
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (select 1 from public.members m where m.user_id = auth.uid()) then
    insert into public.businesses (name, join_code) values (coalesce(nullif(trim(p_name), ''), 'Mi negocio'), public.notas_new_code())
      returning id into new_id;
    insert into public.members (business_id, user_id, role) values (new_id, auth.uid(), 'owner');
  end if;
  return query select * from public.notas_membership();
end
$$;

-- Another person joins with the business code.
create or replace function public.notas_join(p_code text) returns table (business_id uuid, business_name text, join_code text, role text)
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  select b.id into target from public.businesses b where b.join_code = upper(trim(p_code));
  if target is null then
    raise exception 'join_code_not_found';
  end if;
  insert into public.members (business_id, user_id, role) values (target, auth.uid(), 'member') on conflict do nothing;
  return query
    select b.id, b.name, b.join_code, m.role
    from public.members m join public.businesses b on b.id = m.business_id
    where m.user_id = auth.uid() and b.id = target;
end
$$;

revoke all on function public.notas_bootstrap(text), public.notas_join(text), public.notas_membership(), public.notas_new_code() from public, anon;
grant execute on function public.notas_bootstrap(text), public.notas_join(text), public.notas_membership() to authenticated;
grant execute on function public.notas_is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Readable views (schema version 2): the same tables and columns as the app's CSV export (js/export.js), for SQL clients, Supabase's
-- table editor, Excel or Power BI. They read public.documents with the caller's rights (security_invoker), so access rules still apply.
-- Money in pesos; kg with three decimals; states in Spanish words.
-- ---------------------------------------------------------------------------------------------------------------------------------

create or replace function public.notas_estado(s text) returns text
language sql immutable as $$
  select case s when 'ordered' then 'pedido' when 'preparing' then 'en_preparacion' when 'delivered' then 'entregado'
    when 'received_signed' then 'firmado' when 'cancelled' then 'cancelado' else s end
$$;

create or replace view public.v_productos with (security_invoker = true) as
select d.business_id as negocio_id, split_part(d.path, '/', 2) as id, d.data ->> 'name' as nombre,
  coalesce((d.data ->> 'active')::boolean, true) as activo, (d.data ->> 'position')::integer as posicion,
  (d.data ->> 'updatedAt')::timestamptz as actualizado, d.deleted_at as eliminado
from public.documents d where d.collection = 'products';

create or replace view public.v_presentaciones with (security_invoker = true) as
select d.business_id as negocio_id, x ->> 'id' as id, split_part(d.path, '/', 2) as producto_id, d.data ->> 'name' as producto,
  x ->> 'label' as presentacion, (x ->> 'grams')::integer as gramos, ((x ->> 'price')::numeric / 100)::numeric(12, 2) as precio,
  coalesce((x ->> 'active')::boolean, true) as activa
from public.documents d cross join lateral jsonb_array_elements(coalesce(d.data -> 'presentations', '[]'::jsonb)) x
where d.collection = 'products';

create or replace view public.v_clientes with (security_invoker = true) as
select d.business_id as negocio_id, split_part(d.path, '/', 2) as id, d.data ->> 'name' as nombre,
  nullif(d.data ->> 'phone', '') as telefono, nullif(d.data ->> 'comment', '') as comentario,
  (d.data ->> 'updatedAt')::timestamptz as actualizado, d.deleted_at as eliminado
from public.documents d where d.collection = 'customers';

create or replace view public.v_renglones with (security_invoker = true) as
select n.business_id as negocio_id, split_part(n.path, '/', 2) as nota_id, l.ord::integer as renglon, n.data ->> 'orderId' as pedido_id,
  o.data ->> 'folio' as folio, (n.data ->> 'number')::integer as numero_nota,
  nullif(coalesce(nullif(n.data ->> 'deliveryDate', ''), o.data ->> 'deliveryDate'), '')::date as fecha_entrega,
  nullif(n.data ->> 'customerName', '') as cliente, l.v ->> 'productId' as producto_id, l.v ->> 'productName' as producto,
  l.v ->> 'presentationId' as presentacion_id, l.v ->> 'presentationLabel' as presentacion, (l.v ->> 'grams')::integer as gramos,
  (l.v ->> 'qty')::integer as cantidad, ((l.v ->> 'unitPrice')::numeric / 100)::numeric(12, 2) as precio,
  ((l.v ->> 'unitPrice')::numeric * (l.v ->> 'qty')::numeric / 100)::numeric(12, 2) as importe,
  (case when (l.v ->> 'grams')::integer > 0 then (l.v ->> 'grams')::numeric * (l.v ->> 'qty')::numeric / 1000 end)::numeric(12, 3) as kg,
  public.notas_estado(n.data ->> 'stage') as estado_nota,
  (n.deleted_at is null and coalesce(n.data ->> 'stage', '') <> 'cancelled' and o.deleted_at is null
    and coalesce(o.data ->> 'stage', '') <> 'cancelled') as cuenta
from public.documents n
cross join lateral jsonb_array_elements(coalesce(n.data -> 'lines', '[]'::jsonb)) with ordinality l(v, ord)
left join public.documents o on o.business_id = n.business_id and o.path = 'orders/' || (n.data ->> 'orderId')
where n.collection = 'notes';

create or replace view public.v_notas with (security_invoker = true) as
select n.business_id as negocio_id, split_part(n.path, '/', 2) as id, n.data ->> 'orderId' as pedido_id, o.data ->> 'folio' as folio,
  (n.data ->> 'number')::integer as numero, nullif(n.data ->> 'customerName', '') as cliente,
  nullif(coalesce(nullif(n.data ->> 'deliveryDate', ''), o.data ->> 'deliveryDate'), '')::date as fecha_entrega,
  public.notas_estado(n.data ->> 'stage') as estado, nullif(n.data ->> 'comment', '') as comentario,
  (coalesce((select sum((l ->> 'unitPrice')::numeric * (l ->> 'qty')::numeric)
             from jsonb_array_elements(coalesce(n.data -> 'lines', '[]'::jsonb)) l), 0) / 100)::numeric(12, 2) as total,
  n.deleted_at as eliminado
from public.documents n
left join public.documents o on o.business_id = n.business_id and o.path = 'orders/' || (n.data ->> 'orderId')
where n.collection = 'notes';

create or replace view public.v_pagos with (security_invoker = true) as
select p.business_id as negocio_id, split_part(p.path, '/', 2) as id, p.data ->> 'orderId' as pedido_id, o.data ->> 'folio' as folio,
  nullif(p.data ->> 'noteId', '') as nota_id, ((p.data ->> 'amount')::numeric / 100)::numeric(12, 2) as monto,
  case p.data ->> 'method' when 'cash' then 'efectivo' when 'transfer' then 'transferencia' when 'other' then 'otro' else p.data ->> 'method' end as forma,
  coalesce(nullif(p.data ->> 'localDate', ''), left(p.data ->> 'paidAt', 10))::date as fecha, (p.data ->> 'paidAt')::timestamptz as pagado_en,
  nullif(p.data ->> 'comment', '') as comentario, p.deleted_at as eliminado
from public.documents p
left join public.documents o on o.business_id = p.business_id and o.path = 'orders/' || (p.data ->> 'orderId')
where p.collection = 'payments';

create or replace view public.v_pedidos with (security_invoker = true) as
with sums as (
  select o.business_id, o.path, o.data, o.deleted_at,
    coalesce((select sum(t.total) from public.v_notas t
              where t.negocio_id = o.business_id and t.pedido_id = split_part(o.path, '/', 2)
                and t.eliminado is null and t.estado <> 'cancelado'), 0)::numeric(12, 2) as total,
    coalesce((select sum(p.monto) from public.v_pagos p
              where p.negocio_id = o.business_id and p.pedido_id = split_part(o.path, '/', 2) and p.eliminado is null), 0)::numeric(12, 2) as pagado
  from public.documents o where o.collection = 'orders'
)
select s.business_id as negocio_id, split_part(s.path, '/', 2) as id, s.data ->> 'folio' as folio, nullif(s.data ->> 'customerId', '') as cliente_id,
  nullif(s.data ->> 'customerName', '') as cliente, nullif(s.data ->> 'deliveryDate', '')::date as fecha_entrega,
  public.notas_estado(s.data ->> 'stage') as estado, nullif(s.data ->> 'comment', '') as comentario,
  (s.data ->> 'createdAt')::timestamptz as creado,
  coalesce(nullif(s.data ->> 'localDate', ''), left(s.data ->> 'createdAt', 10))::date as fecha,
  s.total, s.pagado, (s.total - s.pagado)::numeric(12, 2) as saldo,
  case when s.pagado > s.total then 'a_favor' when s.pagado = s.total then 'pagado' when s.pagado > 0 then 'parcial' else 'pendiente' end as estado_pago,
  s.deleted_at as eliminado
from sums s;

create or replace view public.v_historial with (security_invoker = true) as
select d.business_id as negocio_id, split_part(d.path, '/', 2) as id, d.data ->> 'path' as documento, d.data ->> 'action' as accion,
  (d.data ->> 'at')::timestamptz as fecha_hora, nullif(d.data ->> 'by', '') as por,
  (select string_agg(k, ' ') from jsonb_object_keys(case when jsonb_typeof(d.data -> 'changes') = 'object' then d.data -> 'changes' else '{}'::jsonb end) k) as campos
from public.documents d where d.collection = 'history';

grant select on public.v_productos, public.v_presentaciones, public.v_clientes, public.v_pedidos, public.v_notas, public.v_renglones,
  public.v_pagos, public.v_historial to authenticated;
revoke all on public.v_productos, public.v_presentaciones, public.v_clientes, public.v_pedidos, public.v_notas, public.v_renglones,
  public.v_pagos, public.v_historial from anon;
