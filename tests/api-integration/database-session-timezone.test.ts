import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, {
  createDatabasePool,
  DATABASE_SESSION_TIME_ZONE,
  schema,
} from "../../apps/api/src/database";
import { agentActorTable } from "../../apps/api/src/database/schema-agent-layer";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Agent Layer columns are `timestamp` WITHOUT time zone. `defaultNow()` stores
// the session's wall clock; drizzle writes JS Dates as UTC wall clock. The API
// pool pins the session time zone so both paths agree. These tests reproduce
// the production condition (server default Asia/Seoul) at the database level
// and prove the pinned pool is unaffected by it.

const NINE_HOURS_SECONDS = 9 * 60 * 60;
const TOLERANCE_MS = 5_000;

function databaseName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set for integration tests");
  return new URL(url).pathname.replace(/^\//, "");
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

type AnyDb = typeof db;

async function sessionTimeZone(client: AnyDb): Promise<string> {
  const result = await client.execute<{ tz: string }>(
    sql`select current_setting('TimeZone') as tz`,
  );
  return result.rows[0]?.tz ?? "";
}

// Insert one row relying on the column default and one carrying an explicit
// JS Date in the same second, then compare what the database hands back.
async function insertPair(client: AnyDb, workspaceId: string) {
  const before = new Date();
  const [byDefault] = await client
    .insert(agentActorTable)
    .values({ workspaceId, provider: "anthropic", model: "tz-default" })
    .returning();
  const [byJsDate] = await client
    .insert(agentActorTable)
    .values({
      workspaceId,
      provider: "anthropic",
      model: "tz-js-date",
      createdAt: new Date(),
    })
    .returning();
  if (!byDefault || !byJsDate) throw new Error("insert returned no rows");
  return { before, byDefault, byJsDate };
}

describe("API integration: database session time zone", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("pins the shared pool's session to UTC", async () => {
    expect(DATABASE_SESSION_TIME_ZONE).toBe("UTC");
    expect(await sessionTimeZone(db)).toBe("UTC");
  });

  it("keeps a DB-default timestamp and a JS Date written in the same second within 5s", async () => {
    const { workspace } = await createWorkspaceMember();
    const { before, byDefault, byJsDate } = await insertPair(db, workspace.id);

    expect(
      Math.abs(byDefault.createdAt.getTime() - byJsDate.createdAt.getTime()),
    ).toBeLessThan(TOLERANCE_MS);
    expect(
      Math.abs(byDefault.createdAt.getTime() - before.getTime()),
    ).toBeLessThan(TOLERANCE_MS);
  });

  describe("when the database's default time zone is Asia/Seoul", () => {
    const name = quoteIdentifier(databaseName());

    beforeAll(async () => {
      // Mirrors a server whose postgresql.conf says timezone = 'Asia/Seoul'
      // for every new session. Applies to sessions opened after this point.
      await db.execute(
        sql.raw(`ALTER DATABASE ${name} SET timezone TO 'Asia/Seoul'`),
      );
    });

    afterAll(async () => {
      await db.execute(sql.raw(`ALTER DATABASE ${name} RESET timezone`));
    });

    it("an unpinned connection inherits Asia/Seoul and now() lands nine hours ahead of UTC", async () => {
      const unpinned = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const { rows } = await unpinned.query<{
          tz: string;
          skew_seconds: string;
        }>(
          `select current_setting('TimeZone') as tz,
                  extract(epoch from (now()::timestamp - (now() at time zone 'UTC'))) as skew_seconds`,
        );
        expect(rows[0]?.tz).toBe("Asia/Seoul");
        expect(Number(rows[0]?.skew_seconds)).toBe(NINE_HOURS_SECONDS);
      } finally {
        await unpinned.end();
      }
    });

    it("a pool built by the API factory still runs in UTC and writes consistent timestamps", async () => {
      const pinnedPool = createDatabasePool();
      const pinnedDb = drizzle(pinnedPool, { schema }) as unknown as AnyDb;
      try {
        expect(await sessionTimeZone(pinnedDb)).toBe("UTC");

        const { workspace } = await createWorkspaceMember();
        const { before, byDefault, byJsDate } = await insertPair(
          pinnedDb,
          workspace.id,
        );

        expect(
          Math.abs(
            byDefault.createdAt.getTime() - byJsDate.createdAt.getTime(),
          ),
        ).toBeLessThan(TOLERANCE_MS);
        expect(
          Math.abs(byDefault.createdAt.getTime() - before.getTime()),
        ).toBeLessThan(TOLERANCE_MS);
      } finally {
        await pinnedPool.end();
      }
    });
  });
});
