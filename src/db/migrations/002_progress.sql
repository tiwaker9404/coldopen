-- live progress for long-running runs (e.g. "rendering scene 3 of 6, 40%").
-- Not part of the journal: it is overwritten freely and never replayed.
alter table runs add column progress jsonb;
