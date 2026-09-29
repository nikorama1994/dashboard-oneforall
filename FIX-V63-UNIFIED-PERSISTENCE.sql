-- =====================================================================
-- V63 - UNIFIED DATABASE PERSISTENCE
-- Jalankan SEKALI di Supabase > SQL Editor.
--
-- Satu RPC atomik untuk SEMUA dataset besar berbasis operational_records:
--   production       (Database 01 / Giling & Gunting)
--   initial_stock    (siap untuk bulk upload bila dipakai kemudian)
--   ntm_waste        (siap untuk bulk upload manual bila dipakai kemudian)
--   quality_incoming (siap untuk bulk upload bila dipakai kemudian)
--   quality_giling   (Database 03 / Quality Giling & Gunting)
--
-- Database 02 / Contong tetap memakai dashboard_state chunked storage,
-- tetapi V63 client WAJIB read-back & verify setelah setiap replace.
-- =====================================================================

begin;

create table if not exists public.operational_records (
  module text not null,
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint operational_records_pkey primary key (module, record_key)
);

create index if not exists operational_records_module_updated_idx
  on public.operational_records(module, updated_at desc);

-- Pastikan store Contong/master tersedia juga.
create table if not exists public.dashboard_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists dashboard_state_updated_idx
  on public.dashboard_state(updated_at desc);

drop function if exists public.replace_operational_upload_v63(text,jsonb,text);

create function public.replace_operational_upload_v63(
  p_module text,
  p_records jsonb,
  p_source_tag text default 'DATABASE_UPLOAD'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_module text := lower(btrim(coalesce(p_module,'')));
  v_source text := upper(btrim(coalesce(p_source_tag,'DATABASE_UPLOAD')));
  v_item jsonb;
  v_key text;
  v_payload jsonb;
  v_incoming integer := 0;
  v_saved integer := 0;
  v_deleted integer := 0;
  v_manual_collision integer := 0;
  v_server_count integer := 0;
  v_upload_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sesi login tidak ditemukan.' using errcode='42501';
  end if;

  select lower(coalesce(p.role,'')) into v_role
  from public.profiles p
  where p.id=auth.uid();

  if v_role not in ('admin','qc_inspector') then
    raise exception 'Hanya Admin atau QC Inspector yang boleh upload database.' using errcode='42501';
  end if;

  if v_module not in ('production','initial_stock','ntm_waste','quality_incoming','quality_giling') then
    raise exception 'Module operasional tidak didukung: %', v_module using errcode='22023';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'Payload upload harus berupa JSON array.' using errcode='22023';
  end if;

  create temporary table if not exists nct_v63_upload (
    record_key text primary key,
    payload jsonb not null
  ) on commit drop;
  truncate table nct_v63_upload;

  for v_item in select value from jsonb_array_elements(p_records)
  loop
    v_key := btrim(coalesce(v_item->>'record_key',''));
    v_payload := coalesce(v_item->'payload','{}'::jsonb);
    if v_key='' or jsonb_typeof(v_payload)<>'object' then
      continue;
    end if;

    v_payload := v_payload || jsonb_build_object('databaseUploadSource',v_source);

    insert into nct_v63_upload(record_key,payload)
    values(v_key,v_payload)
    on conflict(record_key) do update set payload=excluded.payload;
  end loop;

  select count(*) into v_incoming from nct_v63_upload;
  if v_incoming=0 then
    raise exception 'Tidak ada record valid untuk disimpan.' using errcode='22023';
  end if;

  -- Upload-owned = source tag yang sama. Untuk Database 01, juga kenali
  -- legacy payload sebelum databaseUploadSource diperkenalkan.
  delete from public.operational_records r
  where r.module=v_module
    and (
      upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source
      or (
        v_module='production' and v_source='GILING_GUNTING' and (
          upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
          or lower(coalesce(r.payload->>'ambriExcelSource','false'))='true'
        )
      )
    )
    and not exists (
      select 1 from nct_v63_upload t where t.record_key=r.record_key
    );
  get diagnostics v_deleted = row_count;

  select count(*) into v_manual_collision
  from nct_v63_upload t
  join public.operational_records r
    on r.module=v_module and r.record_key=t.record_key
  where not (
    upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source
    or (
      v_module='production' and v_source='GILING_GUNTING' and (
        upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
        or lower(coalesce(r.payload->>'ambriExcelSource','false'))='true'
      )
    )
  );

  insert into public.operational_records as r(
    module,record_key,payload,version,created_at,updated_at,created_by,updated_by
  )
  select
    v_module,t.record_key,t.payload,1,now(),now(),auth.uid(),auth.uid()
  from nct_v63_upload t
  on conflict(module,record_key) do update
  set payload=excluded.payload,
      version=r.version+1,
      updated_at=now(),
      updated_by=auth.uid()
  where
    upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source
    or (
      v_module='production' and v_source='GILING_GUNTING' and (
        upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
        or lower(coalesce(r.payload->>'ambriExcelSource','false'))='true'
      )
    );
  get diagnostics v_saved = row_count;

  select count(*) into v_server_count
  from public.operational_records
  where module=v_module;

  select count(*) into v_upload_count
  from public.operational_records r
  where r.module=v_module
    and upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source;

  return jsonb_build_object(
    'module',v_module,
    'sourceTag',v_source,
    'incoming',v_incoming,
    'saved',v_saved,
    'deleted',v_deleted,
    'manualCollision',v_manual_collision,
    'serverCount',v_server_count,
    'uploadCount',v_upload_count
  );
end;
$$;

revoke all on function public.replace_operational_upload_v63(text,jsonb,text) from public;
grant execute on function public.replace_operational_upload_v63(text,jsonb,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Instalasi dianggap benar bila menghasilkan 1 baris.
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name='replace_operational_upload_v63';
