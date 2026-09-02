import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import appendEntry from "./controllers/append-entry";
import getEntry from "./controllers/get-entry";
import listEntries from "./controllers/list-entries";
import {
  entryDetailSchema,
  entryListSchema,
  entrySummarySchema,
} from "./response";
import { appendEntryBody, listEntriesQuery, projectIdParam } from "./schema";

const appendEntryRoute = createRoute({
  method: "post",
  operationId: "appendAgentEntry",
  path: "/",
  tags: ["Agent Layer"],
  summary: "Append a ledger entry",
  description:
    "Record one unit of agent work. Append-only: there is no update or delete, and a correction is a new entry. This is the agent write surface — agents do not write task comments, which is what keeps a task page bounded.",
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
    400: errorResponse("Invalid body, or unknown project"),
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
    "Newest first. Returns summaries only — `body` and `decision` are excluded at the query level so the cost of a listing stays bounded. Fetch a single entry to read them. Page by passing the previous response's `nextBefore` as `before`.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listEntriesQuery },
  responses: {
    200: jsonResponse("Entry summaries, newest first", entryListSchema),
    400: errorResponse("Unknown project, or unknown cursor"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getEntryRoute = createRoute({
  method: "get",
  operationId: "getAgentEntry",
  path: "/{projectId}/{entryId}",
  tags: ["Agent Layer"],
  summary: "Get one ledger entry",
  description:
    "The full record including `body` and `decision`. Scoped under the project so workspace access resolves the same way as the listing; an entry that belongs to another project is reported as not found.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: {
    params: projectIdParam.extend({ entryId: projectIdParam.shape.projectId }),
  },
  responses: {
    200: jsonResponse("The entry", entryDetailSchema),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Entry not found"),
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
  .openapi(listEntriesRoute, async (c) =>
    c.json(
      await listEntries({
        projectId: c.req.valid("param").projectId,
        ...c.req.valid("query"),
      }),
      200,
    ),
  )
  .openapi(getEntryRoute, async (c) => {
    const { projectId, entryId } = c.req.valid("param");
    return c.json(await getEntry(projectId, entryId), 200);
  });

export default agentEntry;
