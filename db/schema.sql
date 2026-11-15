-- Purpose: The PostgreSQL schema for Connected mode, ready to paste into the Supabase SQL editor (the app shows it on its setup screen).
-- Responsibilities: Create the businesses, members and documents tables, the last-write-wins trigger, the access rules by business
-- membership, and the functions that create or join a business. It must stay idempotent (safe to run any number of times) and never
-- delete rows: the app deletes by setting deleted_at.
--
-- Schema version 1. Requires what Supabase provides: auth.uid() and the "authenticated" role (tests/helpers/postgres.js creates stand-ins).
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
