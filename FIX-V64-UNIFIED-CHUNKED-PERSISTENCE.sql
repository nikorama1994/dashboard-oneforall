-- =====================================================================
-- V64 - UNIFIED CHUNKED DATABASE PERSISTENCE
-- Jalankan SEKALI di Supabase > SQL Editor.
--
-- Tujuan:
--   - Semua bulk upload operational_records memakai backend yang sama.
--   - Dataset besar (contoh Quality 8k+ row) dikirim per chunk agar tidak
--     terkena statement timeout seperti V63 single-RPC.
--   - Record lama TIDAK dihapus sebelum seluruh chunk selesai.
--   - Finalize baru membersihkan record upload lama yang tidak ada di batch baru.
--   - Input manual pada key yang sama tetap dipertahankan.
--
-- Module yang didukung:
--   production, initial_stock, ntm_waste, quality_incoming, quality_giling
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

create table if not exists public.dashboard_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists dashboard_state_updated_idx
  on public.dashboard_state(updated_at desc);

-- V63 boleh tetap ada untuk kompatibilitas, tetapi V64 client tidak memakainya.
drop function if exists public.upsert_operational_upload_chunk_v64(text,jsonb,text,text);
drop function if exists public.finalize_operational_upload_v64(text,text,text,integer);

create function public.upsert_operational_upload_chunk_v64(
  p_module text,
  p_records jsonb,
  p_source_tag text default 'DATABASE_UPLOAD',
  p_upload_id text default ''
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
  v_upload_id text := btrim(coalesce(p_upload_id,''));
  v_item jsonb;
  v_key text;
  v_payload jsonb;
  v_incoming integer := 0;
  v_saved integer := 0;
  v_manual_collision integer := 0;
  v_accepted integer := 0;
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

  if v_upload_id='' then
    raise exception 'Upload ID V64 wajib diisi.' using errcode='22023';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'Payload upload harus berupa JSON array.' using errcode='22023';
  end if;

  create temporary table if not exists nct_v64_chunk (
    record_key text primary key,
    payload jsonb not null
  ) on commit drop;
  truncate table nct_v64_chunk;

  for v_item in select value from jsonb_array_elements(p_records)
  loop
    v_key := btrim(coalesce(v_item->>'record_key',''));
    v_payload := coalesce(v_item->'payload','{}'::jsonb);
    if v_key='' or jsonb_typeof(v_payload)<>'object' then
      continue;
    end if;

    v_payload := v_payload || jsonb_build_object(
      'databaseUploadSource',v_source,
      'databaseUploadBatchId',v_upload_id
    );

    insert into nct_v64_chunk(record_key,payload)
    values(v_key,v_payload)
    on conflict(record_key) do update set payload=excluded.payload;
  end loop;

  select count(*) into v_incoming from nct_v64_chunk;
  if v_incoming=0 then
    raise exception 'Tidak ada record valid pada chunk V64.' using errcode='22023';
  end if;

  -- Hitung key yang sudah ditempati input manual / sumber lain.
  select count(*) into v_manual_collision
  from nct_v64_chunk t
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
  from nct_v64_chunk t
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

  select count(*) into v_accepted
  from public.operational_records r
  join nct_v64_chunk t
    on t.record_key=r.record_key
  where r.module=v_module
    and upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source
    and coalesce(r.payload->>'databaseUploadBatchId','')=v_upload_id;

  return jsonb_build_object(
    'module',v_module,
    'sourceTag',v_source,
    'uploadId',v_upload_id,
    'incoming',v_incoming,
    'saved',v_saved,
    'manualCollision',v_manual_collision,
    'accepted',v_accepted
  );
end;
$$;

create function public.finalize_operational_upload_v64(
  p_module text,
  p_source_tag text default 'DATABASE_UPLOAD',
  p_upload_id text default '',
  p_expected_count integer default 0
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
  v_upload_id text := btrim(coalesce(p_upload_id,''));
  v_deleted integer := 0;
  v_upload_count integer := 0;
  v_server_count integer := 0;
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

  if v_upload_id='' then
    raise exception 'Upload ID V64 wajib diisi.' using errcode='22023';
  end if;

  -- Hanya setelah semua chunk sukses: hapus record upload lama yang tidak
  -- tergabung ke batch baru. Input manual / sumber lain tidak disentuh.
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
    and coalesce(r.payload->>'databaseUploadBatchId','')<>v_upload_id;
  get diagnostics v_deleted = row_count;

  select count(*) into v_upload_count
  from public.operational_records r
  where r.module=v_module
    and upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source
    and coalesce(r.payload->>'databaseUploadBatchId','')=v_upload_id;

  select count(*) into v_server_count
  from public.operational_records
  where module=v_module;

  return jsonb_build_object(
    'module',v_module,
    'sourceTag',v_source,
    'uploadId',v_upload_id,
    'expectedCount',greatest(coalesce(p_expected_count,0),0),
    'uploadCount',v_upload_count,
    'deleted',v_deleted,
    'serverCount',v_server_count
  );
end;
$$;

revoke all on function public.upsert_operational_upload_chunk_v64(text,jsonb,text,text) from public;
revoke all on function public.finalize_operational_upload_v64(text,text,text,integer) from public;
grant execute on function public.upsert_operational_upload_chunk_v64(text,jsonb,text,text) to authenticated;
grant execute on function public.finalize_operational_upload_v64(text,text,text,integer) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Instalasi benar bila menghasilkan 2 baris.
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'upsert_operational_upload_chunk_v64',
    'finalize_operational_upload_v64'
  )
order by routine_name;
