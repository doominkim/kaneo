import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getSetKeys from "./controllers/get-set-keys";
import { featureParams } from "./schema";

const requirementSetKeysSchema = z
  .object({
    feature: z.string(),
    title: z.string(),
    status: z.string(),
    approvedAt: responseTimestamp.nullable(),
    reviewed: z.boolean().openapi({
      description:
        "False while the set's latest save came from an agent or an API key and no person has reviewed it since. The keys apply either way.",
    }),
    updatedAt: responseTimestamp,
    items: z.array(
      z.object({
        key: z.string(),
        status: z.string(),
        layer: z.string().nullable(),
        story: z.string().nullable(),
        updatedAt: responseTimestamp,
      }),
    ),
  })
  .openapi("RequirementSetKeys");

const getRoute = createRoute({
  method: "get",
  operationId: "getRequirementSetKeys",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Requirement keys for spec-check (API-key friendly)",
  description:
    "Keys, statuses and clocks only — no bodies, no links. Meant for `x-api-key` callers such as the spec-check script that must know which keys a test suite has to cover.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("Keys and clocks", requirementSetKeysSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Requirement set not found"),
  },
});

const requirementSet = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(getRoute, async (c) => {
  const { projectId, feature } = c.req.valid("param");
  return c.json(await getSetKeys(projectId, feature), 200);
});

export default requirementSet;
