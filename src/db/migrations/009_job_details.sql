-- a job's requirements, read from its board's description, to tell how well someone fits it.
-- Lever and Ashby boards carry descriptions in their listing; Greenhouse jobs are read one by one
-- when they first come up in someone's suggestions. Empty: the post lists none we could read.
create table job_details (
  job_id        text primary key,
  board         text not null,
  requirements  text[] not null default '{}',
  fetched_at    timestamptz not null default now()
);
create index job_details_board_idx on job_details (board);
