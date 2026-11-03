-- personal access tokens: for the MCP server and scripts, one owner each; only a digest is kept
create table user_tokens (
  id           text primary key,
  owner        text not null,
  digest       text not null unique,
  name         text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index user_tokens_owner_idx on user_tokens (owner);
