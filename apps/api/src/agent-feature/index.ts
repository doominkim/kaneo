import { staleSchema } from "../agent-design/response";
import { featureParams, projectIdParam } from "../agent-requirement/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import listFeatureTasks from "./controllers/list-feature-tasks";
import listFeatures from "./controllers/list-features";
import { listFeaturesQuery } from "./schema";

const lifecycleFields = {
  reviewed: z.boolean().openapi({
    description:
      "False while the latest save came from an agent and no person has reviewed it since.",
  }),
  revisedAt: responseTimestamp,
  deletedAt: nullableResponseTimestamp,
  deletedBy: z.string().nullable(),
};

const featureSummarySchema = z
  .object({
    feature: z.string(),
    title: z.string(),
    requirements: z
      .object({
        status: z.string(),
        approvedAt: responseTimestamp.nullable(),
        ...lifecycleFields,
        itemCount: z.number(),
        activeCount: z.number(),
        coveredCount: z.number(),
        updatedAt: responseTimestamp,
      })
      .nullable(),
    design: z
      .object({
        status: z.string(),
        approvedAt: responseTimestamp.nullable(),
        ...lifecycleFields,
        stale: z.boolean(),
        updatedAt: responseTimestamp,
      })
      .nullable(),
    tasks: z.object({ total: z.number(), done: z.number(), stale: z.number() }),
    updatedAt: responseTimestamp,
  })
  .openapi("AgentFeatureSummary");

const featureListSchema = z
  .object({ features: z.array(featureSummarySchema) })
  .openapi("AgentFeatureList");

const featureTaskListSchema = z
  .object({
    tasks: z.array(
      z.object({
        id: z.string(),
        number: z.number().nullable(),
        title: z.string(),
        status: z.string().nullable(),
        requirementKeys: z.array(z.string()),
        viaDesign: z.boolean(),
        stale: staleSchema,
      }),
    ),
  })
  .openapi("AgentFeatureTaskList");

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentFeatures",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "Feature summaries for a project",
  description:
    "One row per feature slug (union of requirement sets and designs): requirement status, review mark and coverage, design status, review mark and stale verdict, task totals. Soft-deleted documents are left out unless `deleted=true`, which lists only them. A fixed number of queries regardless of project size.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listFeaturesQuery },
  responses: {
    200: jsonResponse(
      "Feature summaries, most recently updated first",
      featureListSchema,
    ),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const tasksRoute = createRoute({
  method: "get",
  operationId: "listAgentFeatureTasks",
  path: "/{projectId}/{feature}/tasks",
  tags: ["Agent Layer"],
  summary: "Tasks derived from one feature",
  description:
    "Tasks linked to the feature's requirement keys or its design, each with its stale verdict and causes. Links to soft-deleted documents are left out.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("Tasks by number", featureTaskListSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const agentFeature = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(
      {
        features: await listFeatures(c.req.valid("param").projectId, {
          deleted: c.req.valid("query").deleted,
        }),
      },
      200,
    ),
  )
  .openapi(tasksRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    return c.json({ tasks: await listFeatureTasks(projectId, feature) }, 200);
  });

export default agentFeature;
