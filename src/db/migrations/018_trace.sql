-- the trace a run was started from (W3C traceparent), so its spans join the API request's trace
alter table runs add column if not exists trace jsonb;
