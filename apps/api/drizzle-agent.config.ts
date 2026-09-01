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
 * `tablesFilter` restricts diffing to `agent_*`, so upstream tables are visible
 * (foreign keys resolve) but never emitted here. This is why every table in
 * schema-agent-layer.ts carries the `agent_` prefix.
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
