-- Ringkasan seluruh record operational di Supabase
select module, count(*) as jumlah_record, max(updated_at) as update_terakhir
from public.operational_records
group by module
order by module;

-- Snapshot Contong/dashboard_state (manifest saja)
select state_key, updated_at,
       case when coalesce((payload->>'chunked')::boolean,false) then payload->>'chunks' else '1' end as chunks
from public.dashboard_state
where state_key in (
  'ext_packaging_production_v27',
  'ext_contong_raw_database_v27',
  'ext_contong_ntm_database_v27',
  'ext_ntm_stock_v27'
)
order by state_key;

-- Pastikan RPC V63 terpasang
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name='replace_operational_upload_v63';
