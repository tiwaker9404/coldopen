-- when they last looked at their job matches: what's new since then goes on Today
alter table job_searches add column seen_at timestamptz;
