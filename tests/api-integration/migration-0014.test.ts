import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../../apps/api/src/database";

/*
 * Runs the real drizzle-agent 0014 SQL against rows in the post-0013 shape,
 * the way migration-0013.test.ts does for 0013: a scratch database per
 * scenario, upstream migrations in full, agent migrations through a journal
 * copy that stops at 0013, raw-SQL seed, then a journal copy that stops at
 * 0014 — applied by the same drizzle migrator the API runs at startup.
 *
 * The seed stands for what a legacy writer could still leave after 0013: rows
 * relying on the old `draft`/`proposed` column defaults, documents without a
 * revision, and a set with several revisions.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const upstreamMigrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const agentMigrationsFolder = resolve(
  currentDir,
  "../../apps/api/drizzle-agent",
);
const agentMigrationsTable = "__drizzle_migrations_agent";

type Journal = { entries: Array<{ idx: number; tag: string }> };

const ids = {
  approver: "m14-user-approver",
  editor: "m14-user-editor",
  workspace: "m14-workspace",
  project: "m14-project",
  column: "m14-column",
  task: "m14-task",
  actor: "m14-actor",
};

const w = `'${ids.workspace}'`;
const p = `'${ids.project}'`;
const approver = `'${ids.approver}'`;
const editor = `'${ids.editor}'`;
const actor = `'${ids.actor}'`;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function scratchDatabase(suffix: string) {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL must be defined for integration tests");
  }
  const scratch = new URL(base);
  const baseName = scratch.pathname.replace(/^\//, "");
  const name = `${baseName.replace(/_test$/, "")}_${suffix}_test`;
  scratch.pathname = `/${name}`;
  const admin = new URL(base);
  admin.pathname = "/postgres";
  return { name, url: scratch.toString(), adminUrl: admin.toString() };
}

async function withAdmin(adminUrl: string, run: (client: Client) => unknown) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

/** A copy of drizzle-agent whose journal ends at `lastIdx`. */
function agentFolderUpTo(root: string, lastIdx: number) {
  const folder = join(root, `agent-upto-${lastIdx}`);
  cpSync(agentMigrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  journal.entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return folder;
}

/** Creates the scratch database and migrates it through 0013. */
async function scratchAt0013(suffix: string) {
  const journal = JSON.parse(
    readFileSync(join(agentMigrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  expect(
    journal.entries.find((entry) => entry.idx === 14)?.tag.startsWith("0014_"),
  ).toBe(true);

  const database = scratchDatabase(suffix);
  await withAdmin(database.adminUrl, async (client) => {
    await client.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)}`,
    );
    await client.query(`CREATE DATABASE ${quoteIdentifier(database.name)}`);
  });
  const tempRoot = mkdtempSync(join(tmpdir(), `kaneo-${suffix}-`));
  const pool = new Pool({ connectionString: database.url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: upstreamMigrationsFolder });
  await migrate(db, {
    migrationsFolder: agentFolderUpTo(tempRoot, 13),
    migrationsTable: agentMigrationsTable,
  });
  await seedBase(pool);
  return {
    pool,
    tempRoot,
    migrateTo14: () =>
      migrate(db, {
        migrationsFolder: agentFolderUpTo(tempRoot, 14),
        migrationsTable: agentMigrationsTable,
      }),
    async dispose() {
      await pool.end();
      await withAdmin(database.adminUrl, (client) =>
        client.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)}`,
        ),
      );
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

async function seedBase(scratch: Pool) {
  const db = drizzle(scratch);
  await db.insert(schema.userTable).values([
    {
      id: ids.approver,
      email: "m14-approver@example.com",
      emailVerified: true,
      name: "Approver",
    },
    {
      id: ids.editor,
      email: "m14-editor@example.com",
      emailVerified: true,
      name: "Editor",
    },
  ]);
  await db.insert(schema.workspaceTable).values({
    id: ids.workspace,
    createdAt: new Date(),
    name: "Migration 0014",
    slug: "migration-0014",
  });
  await db.insert(schema.projectTable).values({
    id: ids.project,
    workspaceId: ids.workspace,
    name: "Migration 0014",
    icon: "Folder",
    slug: "migration-0014",
  });
  await scratch.query(`
    INSERT INTO agent_actor (id, workspace_id, on_behalf_of, provider, model)
    VALUES (${actor}, ${w}, ${editor}, 'anthropic', 'claude-opus-5');
  `);
}

/** Rows a legacy writer could leave after 0013, in the post-0013 shape. */
async function seedLegacyRows(scratch: Pool) {
  // Agent rows go in as raw SQL: the TypeScript tables already describe the
  // post-0014 columns and defaults.
  await scratch.query(`
    INSERT INTO agent_requirement_set
      (id, workspace_id, project_id, feature, title, body, status, approved_at,
       approved_by, next_seq, updated_by, actor_id, reviewed_at, reviewed_by,
       revised_at, created_at, updated_at)
    VALUES
      ('m14-set-draft', ${w}, ${p}, 'draft-feature', 'Legacy draft',
       'Legacy body', 'draft', NULL, NULL, 3, ${editor}, NULL, NULL, NULL,
       '2026-09-10 10:00:00', '2026-09-10 09:00:00', '2026-09-10 10:00:00'),
      ('m14-set-live', ${w}, ${p}, 'live-feature', 'Live requirements',
       'Live body', 'approved', '2026-09-11 11:00:00', ${approver}, 2, NULL,
       ${actor}, '2026-09-11 11:00:00', ${approver}, '2026-09-11 12:00:00',
       '2026-09-11 09:00:00', '2026-09-11 12:00:00');

    -- Inserted out of seq order on purpose; snapshots follow item seq.
    INSERT INTO agent_requirement_item
      (id, set_id, project_id, key, seq, text, layer, status, story)
    VALUES
      ('m14-item-draft-2', 'm14-set-draft', ${p}, 'REQ-DRAFT-FEATURE-2', 2,
       'Second draft criterion', NULL, 'deferred', NULL),
      ('m14-item-draft-1', 'm14-set-draft', ${p}, 'REQ-DRAFT-FEATURE-1', 1,
       'First draft criterion', 'api', 'active', 'Story A'),
      ('m14-item-live-1', 'm14-set-live', ${p}, 'REQ-LIVE-FEATURE-1', 1,
       'Live criterion', 'unit', 'active', NULL);

    INSERT INTO agent_design
      (id, workspace_id, project_id, feature, title, body, status, approved_at,
       approved_by, updated_by, actor_id, revised_at, created_at, updated_at)
    VALUES
      ('m14-design-draft', ${w}, ${p}, 'draft-feature', 'Legacy draft design',
       'Draft design body', 'draft', NULL, NULL, NULL, ${actor},
       '2026-09-10 11:00:00', '2026-09-10 09:30:00', '2026-09-10 11:00:00'),
      ('m14-design-live', ${w}, ${p}, 'live-feature', 'Live design',
       'Live design body', 'approved', '2026-09-12 10:00:00', ${editor},
       ${editor}, NULL, '2026-09-12 10:00:00', '2026-09-12 09:00:00',
       '2026-09-12 10:00:00');

    INSERT INTO agent_design_requirement (design_id, item_id) VALUES
      ('m14-design-draft', 'm14-item-draft-2'),
      ('m14-design-draft', 'm14-item-draft-1');

    INSERT INTO agent_spec_revision
      (id, project_id, set_id, design_id, title, body, requirement_keys,
       created_by, actor_id, reverted_from_id, created_at)
    VALUES
      ('m14-rev-live-old', ${p}, 'm14-set-live', NULL, 'Older title',
       'Older body', NULL, ${approver}, NULL, NULL, '2026-09-11 10:00:00'),
      ('m14-rev-live-new', ${p}, 'm14-set-live', NULL, 'Live requirements',
       'Live body', NULL, NULL, ${actor}, NULL, '2026-09-11 12:00:00'),
      ('m14-rev-design-live', ${p}, NULL, 'm14-design-live', 'Live design',
       'Live design body', '["REQ-LIVE-FEATURE-1"]', ${editor}, NULL, NULL,
       '2026-09-12 10:00:00');

    INSERT INTO agent_decision
      (id, workspace_id, project_id, number, title, context, decision, status,
       supersedes_decision_id, created_by, created_actor_id, updated_by,
       updated_actor_id, accepted_by, accepted_at, reviewed_at, reviewed_by,
       created_at, updated_at)
    VALUES
      ('m14-adr-accepted', ${w}, ${p}, 1, 'Accepted ADR', 'Context',
       'Decision', 'accepted', NULL, ${editor}, NULL, ${editor}, NULL,
       ${editor}, '2026-09-10 09:00:00', '2026-09-10 09:00:00', ${editor},
       '2026-09-10 09:00:00', '2026-09-10 09:00:00'),
      ('m14-adr-draft', ${w}, ${p}, 2, 'Legacy draft ADR', 'Context',
       'Decision', 'draft', NULL, NULL, ${actor}, NULL, ${actor}, NULL, NULL,
       NULL, NULL, '2026-09-10 10:00:00', '2026-09-10 10:30:00');

    INSERT INTO agent_term
      (id, workspace_id, canonical, confidence, owner_id, actor_id,
       reviewer_id, reviewed_at, reject_reason, created_at, updated_at)
    VALUES
      ('m14-term-proposed', ${w}, 'Legacy proposed term', 'proposed',
       ${editor}, ${actor}, NULL, NULL, NULL, '2026-09-10 09:00:00',
       '2026-09-10 10:00:00'),
      ('m14-term-disputed', ${w}, 'Disputed term', 'disputed', ${editor},
       ${actor}, ${approver}, '2026-09-10 12:00:00', 'Means something else',
       '2026-09-10 09:00:00', '2026-09-10 12:30:00');
  `);
}

describe("drizzle-agent 0014 integrity migration (agent-autoapply)", () => {
  let scratch: Awaited<ReturnType<typeof scratchAt0013>> | undefined;
  const rows = async (text: string) => {
    if (!scratch) throw new Error("scratch database is not initialised");
    return (await scratch.pool.query(text)).rows as Array<
      Record<string, unknown>
    >;
  };

  beforeAll(async () => {
    scratch = await scratchAt0013("migration_0014");
    await seedLegacyRows(scratch.pool);
    await scratch.migrateTo14();
  });

  afterAll(async () => {
    await scratch?.dispose();
    scratch = undefined;
  });

  it("[REQ-AGENT-AUTOAPPLY-39] converts rows a legacy writer left in draft or proposed with 0013's rules", async () => {
    expect(
      await rows(
        `SELECT id, status, approved_at::text, approved_by, reviewed_at::text,
                reviewed_by, revised_at::text
           FROM agent_requirement_set
         UNION ALL
         SELECT id, status, approved_at::text, approved_by, reviewed_at::text,
                reviewed_by, revised_at::text
           FROM agent_design
         ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "m14-design-draft",
        status: "approved",
        approved_at: "2026-09-10 11:00:00",
        approved_by: null,
        reviewed_at: null,
        reviewed_by: null,
        revised_at: "2026-09-10 11:00:00",
      },
      {
        // Already approved: untouched.
        id: "m14-design-live",
        status: "approved",
        approved_at: "2026-09-12 10:00:00",
        approved_by: ids.editor,
        reviewed_at: null,
        reviewed_by: null,
        revised_at: "2026-09-12 10:00:00",
      },
      {
        id: "m14-set-draft",
        status: "approved",
        approved_at: "2026-09-10 10:00:00",
        approved_by: null,
        reviewed_at: null,
        reviewed_by: null,
        revised_at: "2026-09-10 10:00:00",
      },
      {
        id: "m14-set-live",
        status: "approved",
        approved_at: "2026-09-11 11:00:00",
        approved_by: ids.approver,
        reviewed_at: "2026-09-11 11:00:00",
        reviewed_by: ids.approver,
        revised_at: "2026-09-11 12:00:00",
      },
    ]);

    expect(
      await rows(
        `SELECT id, number, status, accepted_at::text, accepted_by,
                reviewed_at::text, reviewed_by
           FROM agent_decision ORDER BY number`,
      ),
    ).toEqual([
      {
        id: "m14-adr-accepted",
        number: 1,
        status: "accepted",
        accepted_at: "2026-09-10 09:00:00",
        accepted_by: ids.editor,
        reviewed_at: "2026-09-10 09:00:00",
        reviewed_by: ids.editor,
      },
      {
        id: "m14-adr-draft",
        number: 2,
        status: "accepted",
        accepted_at: "2026-09-10 10:30:00",
        accepted_by: null,
        reviewed_at: null,
        reviewed_by: null,
      },
    ]);

    expect(
      await rows(
        `SELECT id, confidence, reviewer_id, reviewed_at::text, reject_reason
           FROM agent_term ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "m14-term-disputed",
        confidence: "disputed",
        reviewer_id: ids.approver,
        reviewed_at: "2026-09-10 12:00:00",
        reject_reason: "Means something else",
      },
      {
        id: "m14-term-proposed",
        confidence: "confirmed",
        reviewer_id: null,
        reviewed_at: null,
        reject_reason: null,
      },
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-39] gives a document without a revision its baseline and stores item rows on each set's newest revision only", async () => {
    const revisions = await rows(
      `SELECT id, set_id, design_id, title, body, requirement_keys, items,
              created_by, actor_id, reverted_from_id, created_at::text
         FROM agent_spec_revision`,
    );
    expect(revisions).toHaveLength(5);

    const byTarget = (target: string) =>
      revisions
        .filter((r) => r.set_id === target || r.design_id === target)
        .map(({ id: _id, ...revision }) => revision)
        .sort((a, b) =>
          String(a.created_at).localeCompare(String(b.created_at)),
        );

    expect(byTarget("m14-set-draft")).toEqual([
      {
        set_id: "m14-set-draft",
        design_id: null,
        title: "Legacy draft",
        body: "Legacy body",
        requirement_keys: null,
        items: [
          {
            key: "REQ-DRAFT-FEATURE-1",
            text: "First draft criterion",
            layer: "api",
            story: "Story A",
            status: "active",
          },
          {
            key: "REQ-DRAFT-FEATURE-2",
            text: "Second draft criterion",
            layer: null,
            story: null,
            status: "deferred",
          },
        ],
        created_by: ids.editor,
        actor_id: null,
        reverted_from_id: null,
        created_at: "2026-09-10 10:00:00",
      },
    ]);

    // The older revision's rows were never recorded, so they stay unknown.
    expect(byTarget("m14-set-live").map((r) => [r.title, r.items])).toEqual([
      ["Older title", null],
      [
        "Live requirements",
        [
          {
            key: "REQ-LIVE-FEATURE-1",
            text: "Live criterion",
            layer: "unit",
            story: null,
            status: "active",
          },
        ],
      ],
    ]);

    expect(byTarget("m14-design-draft")).toEqual([
      {
        set_id: null,
        design_id: "m14-design-draft",
        title: "Legacy draft design",
        body: "Draft design body",
        requirement_keys: ["REQ-DRAFT-FEATURE-1", "REQ-DRAFT-FEATURE-2"],
        items: null,
        created_by: null,
        actor_id: ids.actor,
        reverted_from_id: null,
        created_at: "2026-09-10 11:00:00",
      },
    ]);
    // A design that already had a revision gets no second one.
    expect(byTarget("m14-design-live").map((r) => [r.title, r.items])).toEqual([
      ["Live design", null],
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-39] defaults now match what the application writes", async () => {
    expect(
      await rows(`
        INSERT INTO agent_requirement_set (id, workspace_id, project_id, feature, title)
        VALUES ('m14-default-set', ${w}, ${p}, 'default-feature', 'Default')
        RETURNING status`),
    ).toEqual([{ status: "approved" }]);
    expect(
      await rows(`
        INSERT INTO agent_design (id, workspace_id, project_id, feature, title, body)
        VALUES ('m14-default-design', ${w}, ${p}, 'default-feature', 'Default', '')
        RETURNING status`),
    ).toEqual([{ status: "approved" }]);
    expect(
      await rows(`
        INSERT INTO agent_decision (id, workspace_id, project_id, number, title, context, decision)
        VALUES ('m14-default-adr', ${w}, ${p}, 3, 'Default', 'Context', 'Decision')
        RETURNING status`),
    ).toEqual([{ status: "accepted" }]);
    expect(
      await rows(`
        INSERT INTO agent_term (id, workspace_id, canonical)
        VALUES ('m14-default-term', ${w}, 'Default term')
        RETURNING confidence`),
    ).toEqual([{ confidence: "confirmed" }]);
  });

  it("[REQ-AGENT-AUTOAPPLY-39] CHECK constraints refuse draft documents and ADRs and proposed terms", async () => {
    const refused = [
      [
        `INSERT INTO agent_requirement_set (id, workspace_id, project_id, feature, title, status)
         VALUES ('m14-check-set', ${w}, ${p}, 'check-feature', 'Check', 'draft')`,
        "agent_requirement_set_status_not_draft",
      ],
      [
        `INSERT INTO agent_design (id, workspace_id, project_id, feature, title, body, status)
         VALUES ('m14-check-design', ${w}, ${p}, 'check-feature', 'Check', '', 'draft')`,
        "agent_design_status_not_draft",
      ],
      [
        `INSERT INTO agent_decision (id, workspace_id, project_id, number, title, context, decision, status)
         VALUES ('m14-check-adr', ${w}, ${p}, 4, 'Check', 'Context', 'Decision', 'draft')`,
        "agent_decision_status_not_draft",
      ],
      [
        `UPDATE agent_term SET confidence = 'proposed' WHERE id = 'm14-term-disputed'`,
        "agent_term_confidence_not_proposed",
      ],
    ] as const;
    for (const [statement, constraint] of refused) {
      await expect(rows(statement), constraint).rejects.toMatchObject({
        code: "23514",
        constraint,
      });
    }
  });
});

describe("drizzle-agent 0014 refuses a draft ADR that supersedes another", () => {
  let scratch: Awaited<ReturnType<typeof scratchAt0013>> | undefined;

  beforeAll(async () => {
    scratch = await scratchAt0013("migration_0014_guard");
    await scratch.pool.query(`
      INSERT INTO agent_requirement_set
        (id, workspace_id, project_id, feature, title, body, status)
      VALUES
        ('m14-guard-set', ${w}, ${p}, 'guard-feature', 'Guard', '', 'draft');

      INSERT INTO agent_decision
        (id, workspace_id, project_id, number, title, context, decision,
         status, supersedes_decision_id)
      VALUES
        ('m14-guard-target', ${w}, ${p}, 1, 'Target', 'Context', 'Decision',
         'accepted', NULL),
        ('m14-guard-draft', ${w}, ${p}, 2, 'Bad draft', 'Context', 'Decision',
         'draft', 'm14-guard-target');
    `);
  });

  afterAll(async () => {
    await scratch?.dispose();
    scratch = undefined;
  });

  it("[REQ-AGENT-AUTOAPPLY-39] fails with the offending ADR named and leaves the database at 0013", async () => {
    if (!scratch) throw new Error("scratch database is not initialised");
    let failure: unknown;
    try {
      await scratch.migrateTo14();
    } catch (error) {
      failure = error;
    }
    const messages: string[] = [];
    for (
      let current = failure as
        | { message?: string; cause?: unknown }
        | undefined;
      current;
      current = current.cause as typeof current
    ) {
      if (current.message) messages.push(current.message);
    }
    expect(messages.join("\n")).toMatch(
      /draft ADR\(s\) m14-guard-draft carry supersedes_decision_id/,
    );

    const { rows } = await scratch.pool.query(`
      SELECT
        (SELECT status FROM agent_requirement_set WHERE id = 'm14-guard-set') AS set_status,
        (SELECT status FROM agent_decision WHERE id = 'm14-guard-draft') AS adr_status,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_name = 'agent_spec_revision' AND column_name = 'items') AS items_column,
        (SELECT count(*)::int FROM drizzle.${agentMigrationsTable}) AS applied
    `);
    expect(rows).toEqual([
      {
        set_status: "draft",
        adr_status: "draft",
        items_column: 0,
        applied: 14,
      },
    ]);
  });
});
