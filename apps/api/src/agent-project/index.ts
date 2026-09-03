import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getSettings from "./controllers/get-settings";
import getTree from "./controllers/get-tree";
import putSettings from "./controllers/put-settings";
import { settingsSchema, treeSchema } from "./response";
import { projectIdParam, putSettingsBody } from "./schema";

const treeRoute = createRoute({
  method: "get",
  operationId: "getAgentProjectTree",
  path: "/{projectId}/tree",
  tags: ["Agent Layer"],
  summary: "Task timeline tree",
  description:
    "The overview tree in one call: root tasks (not a `subtask` target) in creation order, children nested via subtask relations, and per task the distinct branches from its ledger entries, linked documents, uploaded artifacts and token usage. Derived from the ledger, tasks and artifact records — nothing here is stored separately. `threshold` compares the live open-task count with the project's `activeTaskThreshold`.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The tree", treeSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  operationId: "getAgentProjectSettings",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "Project settings",
  description:
    "Core-path patterns, active-task threshold and done-archive days. When nothing has been saved yet the defaults are returned with `configured: false`; reading never creates the row.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The settings, or defaults", settingsSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const putSettingsRoute = createRoute({
  method: "put",
  operationId: "putAgentProjectSettings",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "Replace project settings",
  description:
    "Full replacement (upsert). Requires project:update — the patterns decide what every future entry reports as a core change, so this is a project-level decision, not a task edit. Existing entries are never re-judged.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: putSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved settings", settingsSchema),
    400: errorResponse("Invalid body, or unknown project"),
    403: errorResponse("No workspace access, or missing project:update"),
  },
});

const agentProject = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(treeRoute, async (c) =>
    c.json(await getTree(c.req.valid("param").projectId), 200),
  )
  .openapi(getSettingsRoute, async (c) =>
    c.json(await getSettings(c.req.valid("param").projectId), 200),
  )
  .openapi(putSettingsRoute, async (c) =>
    c.json(
      await putSettings({
        ...c.req.valid("json"),
        projectId: c.req.valid("param").projectId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  );

export default agentProject;
