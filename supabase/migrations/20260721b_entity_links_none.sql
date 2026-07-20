-- ONE BRAIN Phase A fix — remember REFUSALS. A 'none' verdict (item judged "not a body of work" —
-- broadcast/notification) must be recorded, or the item is RE-JUDGED on every encounter and the verdict
-- can flip as the candidate set grows (the duplicate-founding bug the DB smoke caught). A human doesn't
-- re-read a newsletter either: the memory remembers having refused. entity_id becomes nullable; a
-- refusal is a link row with entity_id NULL and via='none' (+ the model's reason — still auditable).
-- Apply manually. Re-runnable.

alter table entity_links alter column entity_id drop not null;
