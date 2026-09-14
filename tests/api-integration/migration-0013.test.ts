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
 * Runs the real drizzle-agent 0013 SQL against rows in the pre-0013 shape.
 *
 * The shared test database is always migrated to the newest journal entry, so
 * it cannot hold pre-0013 rows. This file builds its own scratch database
 * instead: upstream migrations in full, agent migrations through a journal copy
 * that stops at 0012, raw-SQL seed, then a journal copy that stops at 0013 —
 * applied by the same drizzle migrator the API runs at startup. Stopping at
 * 0013 keeps later migrations from changing what this file asserts.
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
  approver: "m13-user-approver",
  editor: "m13-user-editor",
  workspace: "m13-workspace",
  project: "m13-project",
  column: "m13-column",
  task: "m13-task",
  actor: "m13-actor",
};

let pool: Pool | undefined;
let tempRoot: string | undefined;

function getPool() {
  if (!pool) throw new Error("scratch database pool is not initialised");
  return pool;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function scratchDatabase() {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL must be defined for integration tests");
  }
  const scratch = new URL(base);
  const baseName = scratch.pathname.replace(/^\//, "");
  const name = `${baseName.replace(/_test$/, "")}_migration_0013_test`;
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

async function seedPre0013Rows(scratch: Pool) {
  const db = drizzle(scratch);
  await db.insert(schema.userTable).values([
    {
      id: ids.approver,
      email: "m13-approver@example.com",
      emailVerified: true,
      name: "Approver",
    },
    {
      id: ids.editor,
      email: "m13-editor@example.com",
      emailVerified: true,
      name: "Editor",
    },
  ]);
  await db.insert(schema.workspaceTable).values({
    id: ids.workspace,
    createdAt: new Date(),
    name: "Migration 0013",
    slug: "migration-0013",
  });
  await db.insert(schema.projectTable).values({
    id: ids.project,
    workspaceId: ids.workspace,
    name: "Migration 0013",
    icon: "Folder",
    slug: "migration-0013",
  });
  await db.insert(schema.columnTable).values({
    id: ids.column,
    projectId: ids.project,
    name: "To do",
    slug: "to-do",
    position: 1,
    isFinal: false,
  });
  await db.insert(schema.taskTable).values({
    id: ids.task,
    projectId: ids.project,
    title: "Linked task",
    description: "",
    priority: "medium",
    status: "to-do",
    columnId: ids.column,
    number: 1,
    position: 1,
  });

  // Agent rows go in as raw SQL: the TypeScript tables already describe the
  // post-0013 columns, which do not exist yet at this point.
  const w = `'${ids.workspace}'`;
  const p = `'${ids.project}'`;
  const approver = `'${ids.approver}'`;
  const editor = `'${ids.editor}'`;
  const actor = `'${ids.actor}'`;
  await scratch.query(`
    INSERT INTO agent_actor (id, workspace_id, on_behalf_of, provider, model)
    VALUES (${actor}, ${w}, ${editor}, 'anthropic', 'claude-opus-5');

    INSERT INTO agent_requirement_set
      (id, workspace_id, project_id, feature, title, body, status, approved_at,
       approved_by, next_seq, updated_by, actor_id, created_at, updated_at)
    VALUES
      ('m13-set-draft', ${w}, ${p}, 'draft-feature', 'Draft requirements',
       'Draft requirement body', 'draft', NULL, NULL, 2, ${editor}, NULL,
       '2026-09-01 09:00:00', '2026-09-01 10:00:00'),
      ('m13-set-approved', ${w}, ${p}, 'approved-feature',
       'Approved requirements', 'Approved requirement body', 'approved',
       '2026-09-02 11:00:00', ${approver}, 3, NULL, ${actor},
       '2026-09-02 09:00:00', '2026-09-02 12:00:00');

    INSERT INTO agent_requirement_item (id, set_id, project_id, key, seq, text)
    VALUES
      ('m13-item-draft-1', 'm13-set-draft', ${p}, 'REQ-DRAFT-FEATURE-1', 1,
       'Draft criterion'),
      ('m13-item-approved-1', 'm13-set-approved', ${p},
       'REQ-APPROVED-FEATURE-1', 1, 'First approved criterion'),
      ('m13-item-approved-2', 'm13-set-approved', ${p},
       'REQ-APPROVED-FEATURE-2', 2, 'Second approved criterion');

    -- m13-design-draft was approved once and reopened, so it still carries
    -- the old approval columns while its status is draft.
    INSERT INTO agent_design
      (id, workspace_id, project_id, feature, title, body, status, approved_at,
       approved_by, updated_by, actor_id, created_at, updated_at)
    VALUES
      ('m13-design-draft', ${w}, ${p}, 'draft-feature', 'Draft design',
       'Draft design body', 'draft', '2026-08-30 08:00:00', ${approver}, NULL,
       ${actor}, '2026-09-01 09:30:00', '2026-09-01 11:00:00'),
      ('m13-design-approved', ${w}, ${p}, 'approved-feature', 'Approved design',
       'Approved design body', 'approved', '2026-09-03 11:00:00', ${approver},
       ${editor}, NULL, '2026-09-03 09:00:00', '2026-09-03 10:00:00'),
      ('m13-design-unlinked', ${w}, ${p}, 'unlinked-feature', 'Unlinked design',
       'Unlinked design body', 'approved', '2026-09-04 11:00:00', ${approver},
       ${editor}, NULL, '2026-09-04 09:00:00', '2026-09-04 10:00:00');

    -- Inserted out of seq order on purpose; revision keys follow item seq.
    INSERT INTO agent_design_requirement (design_id, item_id) VALUES
      ('m13-design-draft', 'm13-item-draft-1'),
      ('m13-design-approved', 'm13-item-approved-2'),
      ('m13-design-approved', 'm13-item-approved-1');

    INSERT INTO agent_decision
      (id, workspace_id, project_id, number, title, context, decision, status,
       supersedes_decision_id, created_by, created_actor_id, updated_by,
       updated_actor_id, accepted_by, accepted_at, created_at, updated_at)
    VALUES
      ('m13-adr-accepted', ${w}, ${p}, 1, 'Accepted ADR', 'Context', 'Decision',
       'accepted', NULL, ${editor}, NULL, ${editor}, NULL, ${approver},
       '2026-09-02 11:00:00', '2026-09-02 09:00:00', '2026-09-02 10:00:00'),
      ('m13-adr-superseded', ${w}, ${p}, 2, 'Superseded ADR', 'Context',
       'Decision', 'superseded', NULL, ${editor}, NULL, ${editor}, NULL,
       ${approver}, '2026-09-03 11:00:00', '2026-09-03 09:00:00',
       '2026-09-03 10:00:00'),
      ('m13-adr-replacement', ${w}, ${p}, 3, 'Replacement ADR', 'Context',
       'Decision', 'accepted', 'm13-adr-superseded', NULL, ${actor}, NULL,
       ${actor}, ${editor}, '2026-09-04 11:00:00', '2026-09-04 09:00:00',
       '2026-09-04 10:00:00'),
      ('m13-adr-draft', ${w}, ${p}, 4, 'Draft ADR', 'Context', 'Decision',
       'draft', NULL, NULL, ${actor}, NULL, ${actor}, NULL, NULL,
       '2026-09-05 09:00:00', '2026-09-05 10:00:00');

    -- m13-term-legacy-confirmed predates the 0008 review columns.
    INSERT INTO agent_term
      (id, workspace_id, canonical, definition, confidence, owner_id, actor_id,
       reviewer_id, reviewed_at, reject_reason, created_at, updated_at)
    VALUES
      ('m13-term-proposed', ${w}, 'Proposed term', 'Definition', 'proposed',
       ${editor}, ${actor}, NULL, NULL, NULL, '2026-09-06 09:00:00',
       '2026-09-06 10:00:00'),
      ('m13-term-confirmed', ${w}, 'Confirmed term', 'Definition', 'confirmed',
       ${editor}, NULL, ${approver}, '2026-09-06 12:00:00', NULL,
       '2026-09-06 09:00:00', '2026-09-06 13:00:00'),
      ('m13-term-legacy-confirmed', ${w}, 'Legacy confirmed term', 'Definition',
       'confirmed', ${editor}, NULL, NULL, NULL, NULL, '2026-08-20 09:00:00',
       '2026-08-21 10:00:00'),
      ('m13-term-disputed', ${w}, 'Disputed term', 'Definition', 'disputed',
       ${editor}, ${actor}, ${approver}, '2026-09-07 12:00:00',
       'Means something else here', '2026-09-07 09:00:00',
       '2026-09-07 12:30:00');

    INSERT INTO agent_task_requirement (task_id, item_id, acknowledged_at)
    VALUES
      ('${ids.task}', 'm13-item-approved-1', '2026-09-08 10:00:00'),
      ('${ids.task}', 'm13-item-approved-2', NULL);

    INSERT INTO agent_task_design (task_id, design_id, acknowledged_at)
    VALUES
      ('${ids.task}', 'm13-design-approved', '2026-09-08 11:00:00'),
      ('${ids.task}', 'm13-design-draft', NULL);
  `);
}

async function rows(text: string, values: unknown[] = []) {
  const result = await getPool().query(text, values);
  return result.rows as Array<Record<string, unknown>>;
}

describe("drizzle-agent 0013 data conversion (agent-autoapply)", () => {
  beforeAll(async () => {
    const journal = JSON.parse(
      readFileSync(
        join(agentMigrationsFolder, "meta", "_journal.json"),
        "utf8",
      ),
    ) as Journal;
    const target = journal.entries.find((entry) => entry.idx === 13);
    expect(target?.tag.startsWith("0013_")).toBe(true);

    const database = scratchDatabase();
    await withAdmin(database.adminUrl, async (client) => {
      await client.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)}`,
      );
      await client.query(`CREATE DATABASE ${quoteIdentifier(database.name)}`);
    });

    tempRoot = mkdtempSync(join(tmpdir(), "kaneo-migration-0013-"));
    pool = new Pool({ connectionString: database.url });
    const db = drizzle(pool);

    await migrate(db, { migrationsFolder: upstreamMigrationsFolder });
    await migrate(db, {
      migrationsFolder: agentFolderUpTo(tempRoot, 12),
      migrationsTable: agentMigrationsTable,
    });
    await seedPre0013Rows(pool);
    await migrate(db, {
      migrationsFolder: agentFolderUpTo(tempRoot, 13),
      migrationsTable: agentMigrationsTable,
    });
  });

  afterAll(async () => {
    await pool?.end();
    pool = undefined;
    const database = scratchDatabase();
    await withAdmin(database.adminUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)}`),
    );
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });

  it("[REQ-AGENT-AUTOAPPLY-39] draft sets, designs and ADRs and proposed terms take effect unreviewed", async () => {
    expect(
      await rows(
        `SELECT status, approved_at::text, approved_by, reviewed_at::text,
                reviewed_by, revised_at::text, deleted_at::text
           FROM agent_requirement_set WHERE id = 'm13-set-draft'`,
      ),
    ).toEqual([
      {
        status: "approved",
        approved_at: "2026-09-01 10:00:00",
        approved_by: null,
        reviewed_at: null,
        reviewed_by: null,
        revised_at: "2026-09-01 10:00:00",
        deleted_at: null,
      },
    ]);

    expect(
      await rows(
        `SELECT status, approved_at::text, approved_by, reviewed_at::text,
                reviewed_by, revised_at::text, deleted_at::text
           FROM agent_design WHERE id = 'm13-design-draft'`,
      ),
    ).toEqual([
      {
        status: "approved",
        approved_at: "2026-09-01 11:00:00",
        // A reopened design keeps its old approver; only the review marker
        // decides whether a person has looked at the current content.
        approved_by: ids.approver,
        reviewed_at: null,
        reviewed_by: null,
        revised_at: "2026-09-01 11:00:00",
        deleted_at: null,
      },
    ]);

    expect(
      await rows(
        `SELECT number, status, accepted_at::text, accepted_by,
                reviewed_at::text, reviewed_by, deleted_at::text
           FROM agent_decision WHERE id = 'm13-adr-draft'`,
      ),
    ).toEqual([
      {
        number: 4,
        status: "accepted",
        accepted_at: "2026-09-05 10:00:00",
        accepted_by: null,
        reviewed_at: null,
        reviewed_by: null,
        deleted_at: null,
      },
    ]);

    expect(
      await rows(
        `SELECT confidence, reviewer_id, reviewed_at::text, deleted_at::text
           FROM agent_term WHERE id = 'm13-term-proposed'`,
      ),
    ).toEqual([
      {
        confidence: "confirmed",
        reviewer_id: null,
        reviewed_at: null,
        deleted_at: null,
      },
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-40] already approved, accepted and confirmed rows end up reviewed", async () => {
    expect(
      await rows(
        `SELECT id, status, approved_at::text, reviewed_at::text, reviewed_by,
                revised_at::text
           FROM agent_requirement_set WHERE id = 'm13-set-approved'
         UNION ALL
         SELECT id, status, approved_at::text, reviewed_at::text, reviewed_by,
                revised_at::text
           FROM agent_design
          WHERE id IN ('m13-design-approved', 'm13-design-unlinked')
         ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "m13-design-approved",
        status: "approved",
        approved_at: "2026-09-03 11:00:00",
        reviewed_at: "2026-09-03 11:00:00",
        reviewed_by: ids.approver,
        revised_at: "2026-09-03 10:00:00",
      },
      {
        id: "m13-design-unlinked",
        status: "approved",
        approved_at: "2026-09-04 11:00:00",
        reviewed_at: "2026-09-04 11:00:00",
        reviewed_by: ids.approver,
        revised_at: "2026-09-04 10:00:00",
      },
      {
        id: "m13-set-approved",
        status: "approved",
        approved_at: "2026-09-02 11:00:00",
        reviewed_at: "2026-09-02 11:00:00",
        reviewed_by: ids.approver,
        revised_at: "2026-09-02 12:00:00",
      },
    ]);

    expect(
      await rows(
        `SELECT id, status, supersedes_decision_id, reviewed_at::text,
                reviewed_by
           FROM agent_decision WHERE number IN (1, 2, 3) ORDER BY number`,
      ),
    ).toEqual([
      {
        id: "m13-adr-accepted",
        status: "accepted",
        supersedes_decision_id: null,
        reviewed_at: "2026-09-02 11:00:00",
        reviewed_by: ids.approver,
      },
      {
        id: "m13-adr-superseded",
        status: "superseded",
        supersedes_decision_id: null,
        reviewed_at: "2026-09-03 11:00:00",
        reviewed_by: ids.approver,
      },
      {
        id: "m13-adr-replacement",
        status: "accepted",
        supersedes_decision_id: "m13-adr-superseded",
        reviewed_at: "2026-09-04 11:00:00",
        reviewed_by: ids.editor,
      },
    ]);

    expect(
      await rows(
        `SELECT id, confidence, reviewer_id, reviewed_at::text
           FROM agent_term
          WHERE id IN ('m13-term-confirmed', 'm13-term-legacy-confirmed')
          ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "m13-term-confirmed",
        confidence: "confirmed",
        reviewer_id: ids.approver,
        reviewed_at: "2026-09-06 12:00:00",
      },
      {
        id: "m13-term-legacy-confirmed",
        confidence: "confirmed",
        reviewer_id: null,
        reviewed_at: "2026-08-21 10:00:00",
      },
    ]);

    expect(
      await rows(
        `SELECT item_id AS target, acknowledged_at::text, reviewed_at::text,
                acknowledged_actor_id
           FROM agent_task_requirement
         UNION ALL
         SELECT design_id, acknowledged_at::text, reviewed_at::text,
                acknowledged_actor_id
           FROM agent_task_design
         ORDER BY target`,
      ),
    ).toEqual([
      {
        target: "m13-design-approved",
        acknowledged_at: "2026-09-08 11:00:00",
        reviewed_at: "2026-09-08 11:00:00",
        acknowledged_actor_id: null,
      },
      {
        target: "m13-design-draft",
        acknowledged_at: null,
        reviewed_at: null,
        acknowledged_actor_id: null,
      },
      {
        target: "m13-item-approved-1",
        acknowledged_at: "2026-09-08 10:00:00",
        reviewed_at: "2026-09-08 10:00:00",
        acknowledged_actor_id: null,
      },
      {
        target: "m13-item-approved-2",
        acknowledged_at: null,
        reviewed_at: null,
        acknowledged_actor_id: null,
      },
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-41] disputed terms are left unchanged", async () => {
    expect(
      await rows(
        `SELECT confidence, reviewer_id, reviewed_at::text, reject_reason,
                updated_at::text, deleted_at::text
           FROM agent_term WHERE id = 'm13-term-disputed'`,
      ),
    ).toEqual([
      {
        confidence: "disputed",
        reviewer_id: ids.approver,
        reviewed_at: "2026-09-07 12:00:00",
        reject_reason: "Means something else here",
        updated_at: "2026-09-07 12:30:00",
        deleted_at: null,
      },
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-42] each existing set and design gets one revision of its current content", async () => {
    const revisions = await rows(
      `SELECT id, project_id, set_id, design_id, title, body, requirement_keys,
              created_by, actor_id, reverted_from_id, created_at::text
         FROM agent_spec_revision`,
    );

    const revisionIds = revisions.map((revision) => revision.id);
    expect(revisionIds.every((id) => typeof id === "string" && id !== "")).toBe(
      true,
    );
    expect(new Set(revisionIds).size).toBe(revisions.length);

    const byTarget = Object.fromEntries(
      revisions.map(({ id: _id, ...revision }) => [
        String(revision.set_id ?? revision.design_id),
        revision,
      ]),
    );
    const common = { project_id: ids.project, reverted_from_id: null };

    expect(byTarget).toEqual({
      "m13-set-draft": {
        ...common,
        set_id: "m13-set-draft",
        design_id: null,
        title: "Draft requirements",
        body: "Draft requirement body",
        requirement_keys: null,
        created_by: ids.editor,
        actor_id: null,
        created_at: "2026-09-01 10:00:00",
      },
      "m13-set-approved": {
        ...common,
        set_id: "m13-set-approved",
        design_id: null,
        title: "Approved requirements",
        body: "Approved requirement body",
        requirement_keys: null,
        created_by: null,
        actor_id: ids.actor,
        created_at: "2026-09-02 12:00:00",
      },
      "m13-design-draft": {
        ...common,
        set_id: null,
        design_id: "m13-design-draft",
        title: "Draft design",
        body: "Draft design body",
        requirement_keys: ["REQ-DRAFT-FEATURE-1"],
        created_by: null,
        actor_id: ids.actor,
        created_at: "2026-09-01 11:00:00",
      },
      "m13-design-approved": {
        ...common,
        set_id: null,
        design_id: "m13-design-approved",
        title: "Approved design",
        body: "Approved design body",
        requirement_keys: ["REQ-APPROVED-FEATURE-1", "REQ-APPROVED-FEATURE-2"],
        created_by: ids.editor,
        actor_id: null,
        created_at: "2026-09-03 10:00:00",
      },
      "m13-design-unlinked": {
        ...common,
        set_id: null,
        design_id: "m13-design-unlinked",
        title: "Unlinked design",
        body: "Unlinked design body",
        requirement_keys: [],
        created_by: ids.editor,
        actor_id: null,
        created_at: "2026-09-04 10:00:00",
      },
    });
  });
});
