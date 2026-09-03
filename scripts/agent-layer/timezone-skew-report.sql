-- Agent Layer timestamp skew report (read-only, dry run).
--
-- Background: the Agent Layer tables use `timestamp` WITHOUT time zone.
-- `defaultNow()` therefore stores the DB session's wall clock, while rows the
-- API writes with a JS Date are stored as UTC wall clock. On a server whose
-- default `timezone` is Asia/Seoul, DB-defaulted rows landed nine hours ahead
-- of API-written ones until the API pinned its session time zone to UTC.
--
-- This script only counts. It never modifies data. Run it with psql against
-- the production database before deciding on a backfill:
--
--   psql "$DATABASE_URL" -f scripts/agent-layer/timezone-skew-report.sql
--
-- Every comparison uses `now() AT TIME ZONE 'UTC'` so the result does not
-- depend on the time zone of the session running the report.

\echo '== Session / server context =='
SELECT
  current_setting('TimeZone') AS session_time_zone,
  (SELECT setting FROM pg_settings WHERE name = 'TimeZone') AS effective_time_zone,
  now() AS now_tz,
  (now() AT TIME ZONE 'UTC') AS now_utc_wall_clock;

\echo ''
\echo '== A. Future-dated rows per table/column (value > now UTC + 1 hour) =='
\echo '   Only rows written in the last ~8 hours under a +9h session are still'
\echo '   "future"; older skewed rows fall below the threshold, so this undercounts.'
WITH threshold AS (
  SELECT (now() AT TIME ZONE 'UTC') + interval '1 hour' AS t
)
SELECT * FROM (
  SELECT 'agent_actor'::text AS table_name, 'created_at'::text AS column_name,
         count(*) FILTER (WHERE created_at > threshold.t) AS future_rows,
         count(*) AS total_rows, max(created_at) AS max_value
  FROM agent_actor, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_actor', 'first_seen_at',
         count(*) FILTER (WHERE first_seen_at > threshold.t), count(*), max(first_seen_at)
  FROM agent_actor, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_actor', 'last_seen_at',
         count(*) FILTER (WHERE last_seen_at > threshold.t), count(*), max(last_seen_at)
  FROM agent_actor, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_entry', 'created_at',
         count(*) FILTER (WHERE created_at > threshold.t), count(*), max(created_at)
  FROM agent_entry, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_entry', 'deleted_at',
         count(*) FILTER (WHERE deleted_at > threshold.t), count(*) FILTER (WHERE deleted_at IS NOT NULL), max(deleted_at)
  FROM agent_entry, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_lease', 'acquired_at',
         count(*) FILTER (WHERE acquired_at > threshold.t), count(*), max(acquired_at)
  FROM agent_lease, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_domain', 'created_at',
         count(*) FILTER (WHERE created_at > threshold.t), count(*), max(created_at)
  FROM agent_domain, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_domain', 'updated_at',
         count(*) FILTER (WHERE updated_at > threshold.t), count(*), max(updated_at)
  FROM agent_domain, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_term', 'created_at',
         count(*) FILTER (WHERE created_at > threshold.t), count(*), max(created_at)
  FROM agent_term, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_term', 'updated_at',
         count(*) FILTER (WHERE updated_at > threshold.t), count(*), max(updated_at)
  FROM agent_term, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_term', 'last_verified_at',
         count(*) FILTER (WHERE last_verified_at > threshold.t), count(*) FILTER (WHERE last_verified_at IS NOT NULL), max(last_verified_at)
  FROM agent_term, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_term', 'last_accessed_at',
         count(*) FILTER (WHERE last_accessed_at > threshold.t), count(*) FILTER (WHERE last_accessed_at IS NOT NULL), max(last_accessed_at)
  FROM agent_term, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_document', 'created_at',
         count(*) FILTER (WHERE created_at > threshold.t), count(*), max(created_at)
  FROM agent_document, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_document', 'updated_at',
         count(*) FILTER (WHERE updated_at > threshold.t), count(*), max(updated_at)
  FROM agent_document, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_artifact', 'created_at',
         count(*) FILTER (WHERE created_at > threshold.t), count(*), max(created_at)
  FROM agent_artifact, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_artifact', 'finalized_at',
         count(*) FILTER (WHERE finalized_at > threshold.t), count(*) FILTER (WHERE finalized_at IS NOT NULL), max(finalized_at)
  FROM agent_artifact, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_project', 'created_at',
         count(*) FILTER (WHERE created_at > threshold.t), count(*), max(created_at)
  FROM agent_project, threshold GROUP BY threshold.t
  UNION ALL
  SELECT 'agent_project', 'updated_at',
         count(*) FILTER (WHERE updated_at > threshold.t), count(*), max(updated_at)
  FROM agent_project, threshold GROUP BY threshold.t
) report
ORDER BY table_name, column_name;

\echo ''
\echo '== B. Impossible orderings (DB-default column ahead of an API-written one by > 1 hour) =='
\echo '   These catch skewed rows of any age: updated_at / deleted_at / finalized_at are'
\echo '   written by the API in UTC, created_at came from the DB default.'
SELECT 'agent_entry'::text AS table_name, 'deleted_at < created_at - 1h'::text AS anomaly,
       count(*) AS rows_affected
FROM agent_entry WHERE deleted_at IS NOT NULL AND deleted_at < created_at - interval '1 hour'
UNION ALL
SELECT 'agent_term', 'updated_at < created_at - 1h', count(*)
FROM agent_term WHERE updated_at < created_at - interval '1 hour'
UNION ALL
SELECT 'agent_document', 'updated_at < created_at - 1h', count(*)
FROM agent_document WHERE updated_at < created_at - interval '1 hour'
UNION ALL
SELECT 'agent_domain', 'updated_at < created_at - 1h', count(*)
FROM agent_domain WHERE updated_at < created_at - interval '1 hour'
UNION ALL
SELECT 'agent_project', 'updated_at < created_at - 1h', count(*)
FROM agent_project WHERE updated_at < created_at - interval '1 hour'
UNION ALL
SELECT 'agent_artifact', 'finalized_at < created_at - 1h', count(*)
FROM agent_artifact WHERE finalized_at IS NOT NULL AND finalized_at < created_at - interval '1 hour'
UNION ALL
SELECT 'agent_actor', 'last_seen_at < first_seen_at - 1h', count(*)
FROM agent_actor WHERE last_seen_at < first_seen_at - interval '1 hour'
UNION ALL
SELECT 'agent_lease', 'expires_at < acquired_at', count(*)
FROM agent_lease WHERE expires_at < acquired_at
ORDER BY table_name, anomaly;

\echo ''
\echo '== C. Rows per table whose created_at is +9h from the row clock of an API-written column =='
\echo '   Skew close to exactly 9 hours (32400 s) is the Asia/Seoul signature.'
SELECT 'agent_term'::text AS table_name,
       count(*) FILTER (WHERE abs(extract(epoch FROM (created_at - updated_at)) - 32400) < 300) AS rows_at_plus_9h,
       count(*) AS total_rows
FROM agent_term
UNION ALL
SELECT 'agent_document',
       count(*) FILTER (WHERE abs(extract(epoch FROM (created_at - updated_at)) - 32400) < 300),
       count(*)
FROM agent_document
UNION ALL
SELECT 'agent_entry',
       count(*) FILTER (WHERE deleted_at IS NOT NULL AND abs(extract(epoch FROM (created_at - deleted_at)) - 32400) < 300),
       count(*) FILTER (WHERE deleted_at IS NOT NULL)
FROM agent_entry
ORDER BY table_name;
