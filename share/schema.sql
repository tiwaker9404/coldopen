-- one row per viewing session of a share page (a page load by a person, not a bot)
create table if not exists film_views (
  film_id     text not null,
  session     text not null,
  -- salted, per-day hash of IP and browser; no address is stored
  viewer      text not null,
  first_seen  text not null,
  last_seen   text not null,
  played      integer not null default 0,
  seconds     real not null default 0,
  finished    integer not null default 0,
  device      text not null,
  referrer    text,
  country     text,
  primary key (film_id, session)
);
create index if not exists film_views_recent_idx on film_views (film_id, last_seen);
