import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import deleteDocument from "./controllers/delete-document";
import getDocument from "./controllers/get-document";
import listDocuments from "./controllers/list-documents";
import putDocument from "./controllers/put-document";
import {
  deleteResultSchema,
  documentListSchema,
  documentSchema,
} from "./response";
import { documentParams, projectIdParam, putDocumentBody } from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentDocuments",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List project documents",
  description:
    "Summaries only — `body` is excluded at the query level. Each row carries `updatedBy` (human) or `actorId` (agent) so the reader can see who wrote the current version, and `updatedAt` so staleness is visible.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Document summaries, by slug", documentListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAgentDocument",
  path: "/{projectId}/{slug}",
  tags: ["Agent Layer"],
  summary: "Get one document",
  description:
    "The full document including its markdown body. A document is a deliverable, not a knowledge-base entry: it has passed no qualification gate, so weigh it by author kind and `updatedAt`.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: documentParams },
  responses: {
    200: jsonResponse("The document", documentSchema),
    400: errorResponse("Unknown project, or invalid slug"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Document not found"),
  },
});

const putRoute = createRoute({
  method: "put",
  operationId: "putAgentDocument",
  path: "/{projectId}/{slug}",
  tags: ["Agent Layer"],
  summary: "Create or replace a document",
  description:
    "Overwrites the document at (project, slug), creating it if absent. Overwrite rather than append is what keeps deliverables bounded. This is the human path: the caller becomes `updatedBy` and `actorId` is cleared. Last write wins.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: documentParams,
    body: {
      required: true,
      content: { "application/json": { schema: putDocumentBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved document", documentSchema),
    400: errorResponse(
      "Invalid body or slug, unknown project, or taskId outside the project",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentDocument",
  path: "/{projectId}/{slug}",
  tags: ["Agent Layer"],
  summary: "Delete a document",
  description:
    "Requires project:update — a stricter gate than writing, because a delete cannot be overwritten back.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: documentParams },
  responses: {
    200: jsonResponse("The deleted document's id and slug", deleteResultSchema),
    400: errorResponse("Unknown project, or invalid slug"),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Document not found"),
  },
});

const agentDocument = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(await listDocuments(c.req.valid("param").projectId), 200),
  )
  .openapi(getRoute, async (c) => {
    const { projectId, slug } = c.req.valid("param");
    return c.json(await getDocument(projectId, slug), 200);
  })
  .openapi(putRoute, async (c) => {
    const { projectId, slug } = c.req.valid("param");
    return c.json(
      await putDocument({
        ...c.req.valid("json"),
        projectId,
        slug,
        workspaceId: c.get("workspaceId"),
        author: { updatedBy: c.get("userId") },
      }),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const { projectId, slug } = c.req.valid("param");
    return c.json(await deleteDocument(projectId, slug), 200);
  });

export default agentDocument;
