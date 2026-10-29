-- what happened after a film was sent, as the sender records it:
-- {"status": "sent" | "replied" | "interview" | "no_reply", "at": "...", "sentAt": "..."}
alter table runs add column outreach jsonb;
create index runs_outreach_idx on runs (owner) where outreach is not null;
