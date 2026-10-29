-- one row per viewing session of a share page (a page load by a person, not a bot)
create table film_views (
  film_id     text not null references runs(id) on delete cascade,
  session     text not null,
  -- salted, per-day hash of IP and browser; no address is stored
  viewer      text not null,
  first_seen  timestamptz not null,
  last_seen   timestamptz not null,
  played      boolean not null default false,
  seconds     real not null default 0,
  finished    boolean not null default false,
  device      text not null,
  referrer    text,
  country     text,
  primary key (film_id, session)
);
create index film_views_recent_idx on film_views (film_id, last_seen desc);
