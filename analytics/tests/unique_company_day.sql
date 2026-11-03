-- one row per company per day
select snapshot_date, board, count(*) as n
from {{ ref('fct_company_day') }}
group by snapshot_date, board
having count(*) > 1
