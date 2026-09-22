-- ============================================================
-- SUPABASE SETUP - Dashboard Produksi Giling
-- Jalankan seluruh file ini di: Supabase > SQL Editor > New query
-- ============================================================

-- 1) PROFILE + ROLE
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) SATU SNAPSHOT DATA DASHBOARD BERSAMA
-- Dashboard lama tetap memakai localStorage secara internal, tetapi snapshot
-- data pentingnya disimpan di sini sehingga Admin dan Viewer melihat data sama.
create table if not exists public.dashboard_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- 3) AUTO-CREATE PROFILE SAAT USER DIBUAT DI AUTH
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,email,name,role)
  values(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,'user'),'@',1)),
    'viewer'
  )
  on conflict (id) do update set
    email=excluded.email,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill profile untuk user yang sudah dibuat sebelum SQL ini dijalankan.
insert into public.profiles(id,email,name,role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'name', split_part(coalesce(u.email,'user'),'@',1)),
  'viewer'
from auth.users u
on conflict (id) do nothing;

-- 4) HELPER UNTUK CEK ADMIN DI RLS
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- 5) ROW LEVEL SECURITY
alter table public.profiles enable row level security;
alter table public.dashboard_state enable row level security;

-- Bersihkan policy lama jika SQL dijalankan ulang.
drop policy if exists "profiles_read_own" on public.profiles;
drop policy if exists "dashboard_read_authenticated" on public.dashboard_state;
drop policy if exists "dashboard_insert_admin" on public.dashboard_state;
drop policy if exists "dashboard_update_admin" on public.dashboard_state;
drop policy if exists "dashboard_delete_admin" on public.dashboard_state;

create policy "profiles_read_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

-- Admin dan Viewer boleh membaca data dashboard.
create policy "dashboard_read_authenticated"
on public.dashboard_state
for select
to authenticated
using (true);

-- Hanya Admin boleh menulis/mengubah/menghapus snapshot data dashboard.
create policy "dashboard_insert_admin"
on public.dashboard_state
for insert
to authenticated
with check (public.current_user_role() = 'admin');

create policy "dashboard_update_admin"
on public.dashboard_state
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "dashboard_delete_admin"
on public.dashboard_state
for delete
to authenticated
using (public.current_user_role() = 'admin');

-- 6) DATA API GRANTS (RLS tetap menjadi pengaman utama)
revoke all on public.profiles from anon;
revoke all on public.dashboard_state from anon;

grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.dashboard_state to authenticated;

-- ============================================================
-- SETELAH MEMBUAT USER ADMIN DI Authentication > Users,
-- jalankan perintah berikut dengan mengganti emailnya:
--
-- update public.profiles
-- set role='admin', name='Admin', updated_at=now()
-- where id=(select id from auth.users where email='EMAIL_ADMIN_ANDA');
--
-- User lain otomatis menjadi viewer. Jika ingin menamai Viewer:
-- update public.profiles
-- set name='Nama Viewer', updated_at=now()
-- where id=(select id from auth.users where email='EMAIL_VIEWER');
-- ============================================================
