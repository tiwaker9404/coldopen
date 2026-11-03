-- One row per open role per snapshot day, typed and classified. Raw layer: the daily CSVs that
-- analytics/snapshot.ts writes from 450+ public job boards.
with raw as (
  select *
  from read_csv(
    '{{ var("snapshots") }}/*.csv.gz',
    header = true,
    all_varchar = true,
    filename = false
  )
),

typed as (
  select
    cast(snapshot_date as date) as snapshot_date,
    board,
    company,
    nullif(yc_batch, '') as yc_batch,
    visa_sponsor = 'true' as visa_sponsor,
    job_id,
    title,
    location,
    in_us = 'true' as in_us,
    remote = 'true' as remote,
    coalesce(nullif(workplace, ''), case when remote = 'true' then 'remote' end) as workplace,
    coalesce(nullif(job_type, ''), 'full_time') as job_type,
    level,
    nullif(team, '') as team,
    try_cast(nullif(posted_at, '') as timestamp) as posted_at,
    try_cast(nullif(pay_min, '') as double) as pay_min,
    try_cast(nullif(pay_max, '') as double) as pay_max,
    nullif(pay_currency, '') as pay_currency
  from raw
),

classified as (
  select
    *,
    -- the job family, from the title: most specific first
    case
      when regexp_matches(lower(title), 'forward[- ]deployed') then 'Forward Deployed Engineering'
      when regexp_matches(lower(title), 'solutions? (engineer|architect|consultant)|sales engineer|pre-?sales|customer engineer') then 'Solutions & Sales Engineering'
      when regexp_matches(lower(title), 'gtm engineer|go[- ]to[- ]market engineer|growth engineer|revops|revenue operations|sales operations') then 'GTM Engineering & RevOps'
      when regexp_matches(lower(title), 'machine learning|\bml\b|\bai\b|research (engineer|scientist)|llm|applied scientist') then 'AI & ML'
      when regexp_matches(lower(title), 'data (engineer|scientist|analyst)|analytics|business intelligence|\bbi\b') then 'Data'
      when regexp_matches(lower(title), 'software|engineer|developer|sre|devops|infrastructure|platform|security') then 'Software Engineering'
      when regexp_matches(lower(title), 'product manager|product owner|\bpm\b') then 'Product'
      when regexp_matches(lower(title), 'design|ux|ui\b') then 'Design'
      when regexp_matches(lower(title), 'account executive|sales|business development|\bsdr\b|\bbdr\b|partnership') then 'Sales'
      when regexp_matches(lower(title), 'marketing|growth|content|brand|communications') then 'Marketing'
      when regexp_matches(lower(title), 'customer success|support|implementation|onboarding|technical account') then 'Customer Success'
      else 'Operations & other'
    end as job_family,
    -- yearly base pay in dollars, where listed
    case when pay_currency = 'USD' and pay_max is not null then (pay_min + pay_max) / 2 end as pay_mid_usd
  from typed
)

select * from classified
