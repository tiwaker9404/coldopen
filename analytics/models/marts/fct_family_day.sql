-- Open US roles by job family on each snapshot day, with listed pay.
select
  snapshot_date,
  job_family,
  count(distinct job_id) as open_roles,
  count(distinct job_id) filter (where posted_at >= snapshot_date - interval 30 day) as new_roles_30d,
  count(distinct board) as companies,
  round(100.0 * count(distinct job_id) filter (where workplace = 'remote') / count(distinct job_id), 1) as remote_pct,
  round(100.0 * count(distinct job_id) filter (where visa_sponsor) / count(distinct job_id), 1) as visa_sponsor_pct,
  count(pay_mid_usd) as roles_with_pay,
  round(quantile_cont(pay_mid_usd, 0.25)) as pay_p25,
  round(quantile_cont(pay_mid_usd, 0.5)) as pay_median,
  round(quantile_cont(pay_mid_usd, 0.75)) as pay_p75
from {{ ref('stg_postings') }}
where in_us and job_type <> 'intern' and level <> 'intern'
group by snapshot_date, job_family
