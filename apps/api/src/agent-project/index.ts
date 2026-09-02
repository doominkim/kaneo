import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getTree from "./controllers/get-tree";
import { treeSchema } from "./response";
import { projectIdParam } from "./schema";

/*
 * Phase 1a exposes only the derived tree. The `agent_project` settings table
 * (core_paths, active_task_threshold, done_archive_days) and its GET/PUT are
 * Phase 1b — see DESIGN.md §4.2 and §8.
 */

const treeRoute = createRoute({
  method: "get",
  operationId: "getAgentProjectTree",
  path: "/{projectId}/tree",
  tags: ["Agent Layer"],
  summary: "Task timeline tree",
  description:
    "The overview tree in one call: root tasks (not a `subtask` target) in creation order, children nested via subtask relations, and per task the distinct branches from its ledger entries, linked documents, uploaded artifacts and token usage. Derived from the ledger, tasks and artifact records — nothing here is stored separately.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The tree", treeSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const agentProject = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(treeRoute, async (c) =>
  c.json(await getTree(c.req.valid("param").projectId), 200),
);

export default agentProject;
