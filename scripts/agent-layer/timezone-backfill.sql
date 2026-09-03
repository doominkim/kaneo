-- Agent Layer timestamp backfill (DRAFT — requires user approval and a backup).
--
-- Scope: rows whose timestamp came from a DB `defaultNow()` while the API's
-- session time zone was Asia/Seoul (+9h). Rows the API wrote with a JS Date
-- (agent_lease.acquired_at/expires_at, agent_entry.deleted_at, agent_artifact
-- after agent.13) were already UTC and must not be touched.
--
-- Run only after:
--   1. pg_dump of the agent_* tables
--   2. the API has been deployed with the UTC session pin (agent.16+)
--   3. :cutoff is set to the UTC wall clock of that deploy
--
--   psql "$DATABASE_URL" -v cutoff="'2026-09-03 00:00:00'" -f scripts/agent-layer/timezone-backfill.sql
--
-- Everything runs in one transaction and ends with ROLLBACK. Change the last
-- line to COMMIT only after reviewing the counts.

BEGIN;

UPDATE agent_entry   SET created_at = created_at - interval '9 hours' WHERE created_at < :cutoff + interval '9 hours';
UPDATE agent_actor   SET created_at = created_at - interval '9 hours', first_seen_at = first_seen_at - interval '9 hours', last_seen_at = last_seen_at - interval '9 hours' WHERE created_at < :cutoff + interval '9 hours';
UPDATE agent_term    SET created_at = created_at - interval '9 hours', updated_at = updated_at - interval '9 hours' WHERE created_at < :cutoff + interval '9 hours';
UPDATE agent_document SET created_at = created_at - interval '9 hours', updated_at = updated_at - interval '9 hours' WHERE created_at < :cutoff + interval '9 hours';
UPDATE agent_domain  SET created_at = created_at - interval '9 hours', updated_at = updated_at - interval '9 hours' WHERE created_at < :cutoff + interval '9 hours';
UPDATE agent_project SET created_at = created_at - interval '9 hours', updated_at = updated_at - interval '9 hours' WHERE created_at < :cutoff + interval '9 hours';

-- Sanity: no future rows should remain.
SELECT 'agent_entry' AS t, count(*) FILTER (WHERE created_at > now() AT TIME ZONE 'UTC') AS future FROM agent_entry
UNION ALL SELECT 'agent_document', count(*) FILTER (WHERE created_at > now() AT TIME ZONE 'UTC') FROM agent_document;

ROLLBACK;
