import { config } from "dotenv-mono";
import { type Config, defineConfig } from "drizzle-kit";
import { resolveDatabaseConnectionString } from "./src/database/resolve-database-url";

config();

/**
 * Agent Layer migrations — fork only.
 *
 * Kept in its own `out` folder with its own journal so that upstream's
 * `drizzle/meta/_journal.json` is never touched. Sharing one journal would
 * guarantee a merge conflict on every upstream migration, because the journal
 * is a single ordered JSON array.
 *
 * Scoping is done by `schema`: only schema-agent-layer.ts is diffed, so only
 * the `agent_*` tables are emitted here. Upstream tables are still visible to
 * the diff through that file's one-way import, which is what lets the foreign
 * keys resolve. (`tablesFilter` is not the mechanism — it applies to
 * push/pull/introspect, not to `generate`.) The `agent_` prefix keeps the two
 * migration sets distinguishable by name in the database.
 *
 *   pnpm --filter @kaneo/api exec drizzle-kit generate --config drizzle-agent.config.ts
 */
export default defineConfig({
  out: "./drizzle-agent",
  schema: "./src/database/schema-agent-layer.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseConnectionString(),
  },
}) satisfies Config;
