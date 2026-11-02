-- pay a Greenhouse post lists on its own page (its board's listing doesn't carry it)
alter table job_details add column pay jsonb;
