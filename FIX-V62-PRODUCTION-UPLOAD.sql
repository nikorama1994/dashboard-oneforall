-- =====================================================================
-- V62 - ATOMIC DATABASE 01 / GILING & GUNTING UPLOAD
-- Jalankan sekali di Supabase > SQL Editor.
--
-- Tujuan:
--   * Seluruh record hasil upload Excel Database 01 disimpan dalam SATU RPC.
--   * Tidak lagi mengirim ratusan/seribuan POST save_operational_record satu per satu.
--   * Upload lama yang berasal dari Excel diganti secara atomik.
--   * Record manual pada key yang sama tetap dipertahankan.
--   * Client dapat memverifikasi jumlah record server sebelum menyatakan sukses.
-- =====================================================================

begin;

-- Pastikan tabel operasional memang tersedia.
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
  on public.operational_records(module, updated_at);

-- Signature baru; aman dijalankan ulang.
drop function if exists public.replace_production_upload(jsonb,text);

create function public.replace_production_upload(
  p_records jsonb,
  p_source_tag text default 'GILING_GUNTING'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_source_tag text := upper(btrim(coalesce(p_source_tag,'GILING_GUNTING')));
  v_item jsonb;
  v_date text;
  v_brand text;
  v_key text;
  v_valid integer := 0;
  v_saved integer := 0;
  v_deleted integer := 0;
  v_manual_collision integer := 0;
  v_server_count integer := 0;
  v_upload_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sesi login tidak ditemukan.' using errcode='42501';
  end if;

  select lower(coalesce(p.role,''))
    into v_role
  from public.profiles p
  where p.id=auth.uid();

  if v_role not in ('admin','qc_inspector') then
    raise exception 'Hanya Admin atau QC Inspector yang boleh upload Database 01.' using errcode='42501';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'Payload Database 01 harus berupa JSON array.' using errcode='22023';
  end if;

  create temporary table if not exists nct_v62_production_upload (
    record_key text primary key,
    payload jsonb not null
  ) on commit drop;
  truncate table nct_v62_production_upload;

  for v_item in select value from jsonb_array_elements(p_records)
  loop
    v_date := left(btrim(coalesce(v_item->>'date','')),10);
    v_brand := btrim(coalesce(v_item->>'brand',''));
    if v_date='' or v_brand='' then
      continue;
    end if;

    v_key := v_date || '|' || v_brand;
    v_item := coalesce(v_item,'{}'::jsonb)
      || jsonb_build_object('databaseUploadSource',v_source_tag);

    insert into nct_v62_production_upload(record_key,payload)
    values(v_key,v_item)
    on conflict(record_key) do update set payload=excluded.payload;
  end loop;

  select count(*) into v_valid from nct_v62_production_upload;
  if v_valid=0 then
    raise exception 'Tidak ada record Brand + Date valid pada Database 01.' using errcode='22023';
  end if;

  -- Hapus hanya data upload lama yang tidak ada lagi pada file baru.
  delete from public.operational_records r
  where r.module='production'
    and (
      upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source_tag
      or upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
      or coalesce((r.payload->>'ambriExcelSource')::boolean,false)=true
    )
    and not exists (
      select 1 from nct_v62_production_upload t where t.record_key=r.record_key
    );
  get diagnostics v_deleted = row_count;

  -- Hitung collision dengan record manual; record manual tidak akan ditimpa.
  select count(*) into v_manual_collision
  from nct_v62_production_upload t
  join public.operational_records r
    on r.module='production' and r.record_key=t.record_key
  where not (
    upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source_tag
    or upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
    or coalesce((r.payload->>'ambriExcelSource')::boolean,false)=true
  );

  -- Insert/update seluruh upload dalam satu transaksi.
  insert into public.operational_records as r(
    module,record_key,payload,version,created_at,updated_at,created_by,updated_by
  )
  select
    'production',t.record_key,t.payload,1,now(),now(),auth.uid(),auth.uid()
  from nct_v62_production_upload t
  on conflict(module,record_key) do update
  set payload=excluded.payload,
      version=r.version+1,
      updated_at=now(),
      updated_by=auth.uid()
  where
    upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source_tag
    or upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
    or coalesce((r.payload->>'ambriExcelSource')::boolean,false)=true;
  get diagnostics v_saved = row_count;

  select count(*) into v_server_count
  from public.operational_records
  where module='production';

  select count(*) into v_upload_count
  from public.operational_records r
  where r.module='production'
    and (
      upper(coalesce(r.payload->>'databaseUploadSource',''))=v_source_tag
      or upper(coalesce(r.payload->>'productionSource',''))='EXCEL'
      or coalesce((r.payload->>'ambriExcelSource')::boolean,false)=true
    );

  return jsonb_build_object(
    'incoming',v_valid,
    'saved',v_saved,
    'deleted',v_deleted,
    'manualCollision',v_manual_collision,
    'serverCount',v_server_count,
    'uploadCount',v_upload_count,
    'sourceTag',v_source_tag
  );
end;
$$;

revoke all on function public.replace_production_upload(jsonb,text) from public;
grant execute on function public.replace_production_upload(jsonb,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verifikasi instalasi V62.
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name='replace_production_upload';
