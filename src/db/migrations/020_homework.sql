-- a film's homework: the sender's own question and something small they built for the company
alter table runs add column if not exists question text;
alter table runs add column if not exists built jsonb;
