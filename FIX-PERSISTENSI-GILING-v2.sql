-- =====================================================================
-- FIX PERSISTENSI DATABASE 01 / GILING & GUNTING
-- Jalankan SEKALI di Supabase > SQL Editor sebagai user pemilik project.
-- Aman dijalankan ulang (idempotent).
-- V2: menghapus RPC versi lama sebelum membuat ulang agar return type tidak bentrok.
--
-- Memperbaiki alur yang dipakai supabase-api.js:
--   production       -> giling_dashboard_2026_v4_clean
--   initial_stock    -> giling_initial_stocks_v2
--   ntm_waste        -> ntm_waste_2026_v2
--   quality_incoming -> quality_incoming_tobacco_v1
--   quality_giling   -> qgg_quality_sampling_progress_v1
-- =====================================================================

begin;

-- 1) Tabel source-of-truth untuk data operasional per record.
create table if not exists public.operational_records (
  module text not null,
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint operational_records_pkey primary key (module, record_key),
  constraint operational_records_module_check check (
    module in ('production','initial_stock','ntm_waste','quality_incoming','quality_giling')
  ),
  constraint operational_records_version_check check (version >= 1)
);

create index if not exists operational_records_module_updated_idx
  on public.operational_records(module, updated_at);

-- 2) RLS: semua user login boleh membaca. Penulisan normal dilakukan lewat RPC
--    SECURITY DEFINER di bawah, yang tetap mengecek role aplikasi.
alter table public.operational_records enable row level security;

drop policy if exists "operational_read_authenticated" on public.operational_records;
create policy "operational_read_authenticated"
on public.operational_records
for select
to authenticated
using (true);

-- Tidak memberikan INSERT/UPDATE/DELETE langsung ke client.
revoke all on public.operational_records from anon;
revoke insert, update, delete on public.operational_records from authenticated;
grant select on public.operational_records to authenticated;

-- 3) RPC save dengan optimistic concurrency control.
--    expected_version = 0 berarti record baru.
-- Bersihkan versi function lama lebih dulu. PostgreSQL tidak mengizinkan
-- CREATE OR REPLACE mengubah return type pada signature yang sama.
drop function if exists public.save_operational_record(text,text,jsonb,bigint);
drop function if exists public.delete_operational_record(text,text,bigint);

create or replace function public.save_operational_record(
  p_module text,
  p_record_key text,
  p_payload jsonb,
  p_expected_version bigint default 0
)
returns setof public.operational_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_existing public.operational_records%rowtype;
  v_inserted public.operational_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sesi login tidak ditemukan.' using errcode = '42501';
  end if;

  select lower(coalesce(p.role,''))
    into v_role
  from public.profiles p
  where p.id = auth.uid();

  if v_role not in ('admin','qc_inspector') then
    raise exception 'Hanya Admin atau QC Inspector yang boleh menyimpan data.' using errcode = '42501';
  end if;

  p_module := btrim(coalesce(p_module,''));
  p_record_key := btrim(coalesce(p_record_key,''));
  p_expected_version := greatest(coalesce(p_expected_version,0),0);

  if p_module not in ('production','initial_stock','ntm_waste','quality_incoming','quality_giling') then
    raise exception 'Module operasional tidak valid.' using errcode = '22023';
  end if;
  if p_record_key = '' then
    raise exception 'Record key tidak valid.' using errcode = '22023';
  end if;

  select r.*
    into v_existing
  from public.operational_records r
  where r.module = p_module
    and r.record_key = p_record_key
  for update;

  if found then
    if v_existing.version <> p_expected_version then
      raise exception 'NCT_CONFLICT|%|%|%', p_module, p_record_key, v_existing.version
        using errcode = 'P0001';
    end if;

    return query
      update public.operational_records r
      set payload = coalesce(p_payload,'{}'::jsonb),
          version = r.version + 1,
          updated_at = now(),
          updated_by = auth.uid()
      where r.module = p_module
        and r.record_key = p_record_key
      returning r.*;
    return;
  end if;

  if p_expected_version <> 0 then
    raise exception 'NCT_CONFLICT|%|%|0', p_module, p_record_key
      using errcode = 'P0001';
  end if;

  -- Dua browser bisa mencoba insert key yang sama bersamaan. ON CONFLICT
  -- mencegah overwrite diam-diam; pihak yang kalah mendapat NCT_CONFLICT.
  insert into public.operational_records(
    module, record_key, payload, version,
    created_at, updated_at, created_by, updated_by
  ) values (
    p_module, p_record_key, coalesce(p_payload,'{}'::jsonb), 1,
    now(), now(), auth.uid(), auth.uid()
  )
  on conflict (module,record_key) do nothing
  returning * into v_inserted;

  if v_inserted.module is null then
    select r.* into v_existing
    from public.operational_records r
    where r.module = p_module and r.record_key = p_record_key;

    raise exception 'NCT_CONFLICT|%|%|%', p_module, p_record_key, coalesce(v_existing.version,0)
      using errcode = 'P0001';
  end if;

  return next v_inserted;
end;
$$;

-- 4) RPC delete dengan pemeriksaan version yang sama.
create or replace function public.delete_operational_record(
  p_module text,
  p_record_key text,
  p_expected_version bigint default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_existing public.operational_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sesi login tidak ditemukan.' using errcode = '42501';
  end if;

  select lower(coalesce(p.role,''))
    into v_role
  from public.profiles p
  where p.id = auth.uid();

  if v_role not in ('admin','qc_inspector') then
    raise exception 'Hanya Admin atau QC Inspector yang boleh menghapus data.' using errcode = '42501';
  end if;

  p_module := btrim(coalesce(p_module,''));
  p_record_key := btrim(coalesce(p_record_key,''));
  p_expected_version := greatest(coalesce(p_expected_version,0),0);

  select r.*
    into v_existing
  from public.operational_records r
  where r.module = p_module
    and r.record_key = p_record_key
  for update;

  if not found then
    return false;
  end if;

  if v_existing.version <> p_expected_version then
    raise exception 'NCT_CONFLICT|%|%|%', p_module, p_record_key, v_existing.version
      using errcode = 'P0001';
  end if;

  delete from public.operational_records r
  where r.module = p_module
    and r.record_key = p_record_key;

  return true;
end;
$$;

revoke all on function public.save_operational_record(text,text,jsonb,bigint) from public;
revoke all on function public.delete_operational_record(text,text,bigint) from public;
grant execute on function public.save_operational_record(text,text,jsonb,bigint) to authenticated;
grant execute on function public.delete_operational_record(text,text,bigint) to authenticated;

-- 5) Realtime agar perubahan dari browser lain bisa langsung terbaca.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1
       from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='operational_records'
     ) then
    alter publication supabase_realtime add table public.operational_records;
  end if;
end $$;

commit;

-- Minta PostgREST/Supabase memuat ulang schema agar RPC baru segera terbaca.
notify pgrst, 'reload schema';

-- 6) CEK HASIL. Harus mengembalikan tabel + dua function.
select to_regclass('public.operational_records') as operational_records;
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in ('save_operational_record','delete_operational_record')
order by routine_name;
