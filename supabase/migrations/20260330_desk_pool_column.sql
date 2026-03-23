ALTER TABLE desk_items
  DROP CONSTRAINT desk_items_kanban_column_check,
  ADD CONSTRAINT desk_items_kanban_column_check
    CHECK (kanban_column IN ('pool', 'todo', 'in_progress', 'waiting', 'done'));
