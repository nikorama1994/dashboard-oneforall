-- =============================================================
-- VERIFY V64
-- =============================================================

-- 1) Ringkasan semua module operational_records
select module, count(*) as jumlah_record, max(updated_at) as update_terakhir
from public.operational_records
group by module
order by module;

-- 2) Snapshot Contong/dashboard_state
select state_key, updated_at,
       case when coalesce((payload->>'chunked')::boolean,false)
            then payload->>'chunks' else '1' end as chunks
from public.dashboard_state
where state_key in (
  'ext_packaging_production_v27',
  'ext_contong_raw_database_v27',
  'ext_contong_ntm_database_v27',
  'ext_ntm_stock_v27'
)
order by state_key;

-- 3) Pastikan dua RPC V64 terpasang
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'upsert_operational_upload_chunk_v64',
    'finalize_operational_upload_v64'
  )
order by routine_name;
