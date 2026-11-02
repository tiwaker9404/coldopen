-- skills the job search should stop asking about ("not relevant" on a fit gap)
alter table job_searches add column ignored_gaps text[] not null default '{}';
