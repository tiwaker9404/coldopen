-- share pages count presses of the button under the film (book a call, or reply)
alter table film_views add column clicked boolean not null default false;
