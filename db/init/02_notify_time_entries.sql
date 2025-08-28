CREATE OR REPLACE FUNCTION time_entries_notify_trigger()
RETURNS trigger AS $$
DECLARE payload json;
BEGIN
  IF TG_OP = 'INSERT' THEN
    payload := json_build_object('op', TG_OP, 'id', NEW.id, 'user_id', NEW.user_id,
                                 'project_id', NEW.project_id, 'work_date', NEW.work_date,
                                 'duration_minutes', NEW.duration_minutes);
    PERFORM pg_notify('time_entries_changes', payload::text);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    payload := json_build_object('op', TG_OP, 'id', NEW.id,
                                 'duration_minutes', NEW.duration_minutes, 'updated_at', now());
    PERFORM pg_notify('time_entries_changes', payload::text);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    payload := json_build_object('op', TG_OP, 'id', OLD.id, 'deleted_at', now());
    PERFORM pg_notify('time_entries_changes', payload::text);
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS time_entries_notify_all ON time_entries;
CREATE TRIGGER time_entries_notify_all
AFTER INSERT OR UPDATE OR DELETE ON time_entries
FOR EACH ROW EXECUTE FUNCTION time_entries_notify_trigger();
