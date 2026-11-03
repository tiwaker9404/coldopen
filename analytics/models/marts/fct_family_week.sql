-- Roles open on the latest snapshot, by the week they were posted: how fast each family is being
-- hired for lately. (Roles already filled have left the boards, so older weeks read low.)
with latest as (
  select * from {{ ref('stg_postings') }}
  where snapshot_date = (select max(snapshot_date) from {{ ref('stg_postings') }})
    and in_us and posted_at is not null
)
select
  date_trunc('week', posted_at)::date as posted_week,
  job_family,
  count(distinct job_id) as roles
from latest
where posted_at >= (select max(snapshot_date) from latest) - interval 84 day
group by posted_week, job_family
