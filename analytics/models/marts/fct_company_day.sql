-- Each company's hiring on each snapshot day: open roles, and roles posted in the 30 days before.
select
  snapshot_date,
  board,
  any_value(company) as company,
  any_value(yc_batch) as yc_batch,
  bool_or(visa_sponsor) as visa_sponsor,
  count(distinct job_id) as open_roles,
  count(distinct job_id) filter (where posted_at >= snapshot_date - interval 30 day) as new_roles_30d,
  count(distinct job_id) filter (where in_us) as us_roles
from {{ ref('stg_postings') }}
group by snapshot_date, board
