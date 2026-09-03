import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import appendEntry from "./controllers/append-entry";
import { deleteEntry, restoreEntry } from "./controllers/delete-entry";
import getEntry from "./controllers/get-entry";
import listEntries from "./controllers/list-entries";
import {
  entryDeleteResultSchema,
  entryDetailSchema,
  entryListSchema,
  entrySummarySchema,
} from "./response";
import {
  appendEntryBody,
  entryParams,
  getEntryQuery,
  listEntriesQuery,
  projectIdParam,
} from "./schema";

/**
 * `includeDeleted=true` is a maintainer's view. Middleware runs before the
 * validators, so this is checked in the handler once the query is parsed; a
 * caller without project:update is told why rather than silently served the
 * filtered list, which would make "I asked for deleted rows and got none"
 * indistinguishable from "there are none".
 */
async function assertMayIncludeDeleted(
  c: Parameters<typeof hasWorkspacePermission>[0],
  includeDeleted: boolean,
) {
  if (!includeDeleted) return;
  if (!(await hasWorkspacePermission(c, { project: ["update"] }))) {
    throw new HTTPException(403, {
      message: "includeDeleted requires project:update",
    });
  }
}

const appendEntryRoute = createRoute({
  method: "post",
  operationId: "appendAgentEntry",
  path: "/",
  tags: ["Agent Layer"],
  summary: "Append a ledger entry",
  description:
    "Record one unit of work on the project's note stream. Append-only: there is no update, a correction is a new entry, and delete only hides a row (see DELETE). Humans and agents share the stream and differ only in attribution: send `provider` + `model` for an agent entry (attributed to an agent_actor, `actor` set), or neither for a human entry (attributed to the calling user, `author` set). One without the other, or `effort`/`agentLabel`/`usage` on a human entry, is a 400.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: appendEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The appended entry", entrySummarySchema),
    400: errorResponse(
      "Invalid body (including provider without model or vice versa, or agent-only fields on a human entry), or unknown project",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const listEntriesRoute = createRoute({
  method: "get",
  operationId: "listAgentEntries",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List ledger entries",
  description:
    "Newest first, human and agent entries interleaved; each row carries `actor` (agent) or `author` (human). Returns summaries only — `body` and `decision` are excluded at the query level so the cost of a listing stays bounded. Fetch a single entry to read them. Page by passing the previous response's `nextBefore` as `before`. Filter with `kind` and `taskId`; `taskId=none` returns the project-level entries that have no task. Soft-deleted entries are hidden unless `includeDeleted=true`, which requires project:update.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listEntriesQuery },
  responses: {
    200: jsonResponse("Entry summaries, newest first", entryListSchema),
    400: errorResponse("Unknown project, or unknown cursor"),
    403: errorResponse(
      "No access to the project's workspace, or `includeDeleted` without project:update",
    ),
  },
});

const getEntryRoute = createRoute({
  method: "get",
  operationId: "getAgentEntry",
  path: "/{projectId}/{entryId}",
  tags: ["Agent Layer"],
  summary: "Get one ledger entry",
  description:
    "The full record including `body` and `decision`. Scoped under the project so workspace access resolves the same way as the listing; an entry that belongs to another project is reported as not found, and so is a soft-deleted one unless `includeDeleted=true` (project:update).",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: entryParams, query: getEntryQuery },
  responses: {
    200: jsonResponse("The entry", entryDetailSchema),
    403: errorResponse(
      "No access to the project's workspace, or `includeDeleted` without project:update",
    ),
    404: errorResponse("Entry not found, or deleted"),
  },
});

const deleteEntryRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentEntry",
  path: "/{projectId}/{entryId}",
  tags: ["Agent Layer"],
  summary: "Delete (hide) a ledger entry",
  description:
    "Soft delete: the row is kept in full and stamped with `deletedAt`/`deletedBy`, then disappears from every default read (listing, get, brief, tail, tree rollups). Allowed for the entry's human author, or for anyone with project:update. An agent entry has no human author, so only project:update can hide it. Undo with the restore endpoint.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: entryParams },
  responses: {
    200: jsonResponse(
      "The entry id and its `deletedAt`",
      entryDeleteResultSchema,
    ),
    403: errorResponse(
      "No workspace access, or neither the author nor a project:update holder",
    ),
    404: errorResponse("Entry not found in this project, or already deleted"),
  },
});

const restoreEntryRoute = createRoute({
  method: "post",
  operationId: "restoreAgentEntry",
  path: "/{projectId}/{entryId}/restore",
  tags: ["Agent Layer"],
  summary: "Restore a deleted ledger entry",
  description:
    "Clears `deletedAt`/`deletedBy` so the entry is read again. Requires project:update — a stricter gate than delete, so hiding one's own note is not a self-service toggle.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: entryParams },
  responses: {
    200: jsonResponse(
      "The entry id with `deletedAt` null",
      entryDeleteResultSchema,
    ),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Entry not found in this project, or not deleted"),
  },
});

const agentEntry = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(appendEntryRoute, async (c) => {
    const input = c.req.valid("json");
    return c.json(
      await appendEntry({
        ...input,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(listEntriesRoute, async (c) => {
    const query = c.req.valid("query");
    await assertMayIncludeDeleted(c, query.includeDeleted);
    return c.json(
      await listEntries({
        projectId: c.req.valid("param").projectId,
        ...query,
      }),
      200,
    );
  })
  .openapi(getEntryRoute, async (c) => {
    const { projectId, entryId } = c.req.valid("param");
    const { includeDeleted } = c.req.valid("query");
    await assertMayIncludeDeleted(c, includeDeleted);
    return c.json(await getEntry(projectId, entryId, includeDeleted), 200);
  })
  .openapi(deleteEntryRoute, async (c) => {
    const { projectId, entryId } = c.req.valid("param");
    return c.json(
      await deleteEntry({
        projectId,
        entryId,
        userId: c.get("userId"),
        canDeleteAny: () => hasWorkspacePermission(c, { project: ["update"] }),
      }),
      200,
    );
  })
  .openapi(restoreEntryRoute, async (c) => {
    const { projectId, entryId } = c.req.valid("param");
    return c.json(await restoreEntry(projectId, entryId), 200);
  });

export default agentEntry;
