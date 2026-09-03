import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import deleteArtifact from "./controllers/delete-artifact";
import finalizeArtifact from "./controllers/finalize-artifact";
import getArtifactUrl from "./controllers/get-artifact-url";
import listArtifacts from "./controllers/list-artifacts";
import presignArtifact from "./controllers/presign-artifact";
import {
  artifactListSchema,
  artifactSchema,
  deleteResultSchema,
  presignResultSchema,
  urlResultSchema,
} from "./response";
import {
  artifactParams,
  finalizeBody,
  listQuery,
  presignBody,
  projectIdParam,
  urlQuery,
} from "./schema";

const presignRoute = createRoute({
  method: "post",
  operationId: "presignAgentArtifact",
  path: "/{projectId}/presign",
  tags: ["Agent Layer"],
  summary: "Start an artifact upload",
  description:
    "Records the artifact (pending) and returns a presigned PUT URL. Upload the bytes with the returned headers, then call finalize. Allowed types: text/html, text/markdown, text/plain, application/json, application/pdf, application/zip; at most 10MiB.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: presignBody } },
    },
  },
  responses: {
    200: jsonResponse("Upload target", presignResultSchema),
    400: errorResponse(
      "Invalid body, disallowed contentType, unknown project, or taskId outside the project",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
    503: errorResponse("Storage is not configured or unreachable"),
  },
});

const finalizeRoute = createRoute({
  method: "post",
  operationId: "finalizeAgentArtifact",
  path: "/{projectId}/finalize",
  tags: ["Agent Layer"],
  summary: "Finish an artifact upload",
  description:
    "Verifies the uploaded object against the presign request (size and content type) and makes the artifact visible. Idempotent for an already finalized artifact.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: finalizeBody } },
    },
  },
  responses: {
    200: jsonResponse("The artifact", artifactSchema),
    400: errorResponse(
      "Object missing, size/content type mismatch, or storageKey does not match",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("Unknown artifact in this project"),
    503: errorResponse("Storage could not be reached to verify the upload"),
  },
});

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentArtifacts",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List artifacts",
  description:
    "Finalized artifacts in the project, newest first, optionally filtered to one task. No URLs here — fetch one per click from the url endpoint.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listQuery },
  responses: {
    200: jsonResponse("Artifacts", artifactListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const urlRoute = createRoute({
  method: "get",
  operationId: "getAgentArtifactUrl",
  path: "/{projectId}/{artifactId}/url",
  tags: ["Agent Layer"],
  summary: "Mint a download URL",
  description:
    "Short-lived presigned GET (default 60s, AGENT_ARTIFACT_URL_TTL_SECONDS). Content type is pinned to the stored value and the disposition is decided server-side: inline only for html/markdown/plain/json/pdf, zip always attachment. HTML must be opened in a sandboxed iframe without allow-same-origin, never injected into the app DOM.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: artifactParams, query: urlQuery },
  responses: {
    200: jsonResponse("Presigned URL", urlResultSchema),
    400: errorResponse("Unknown project or invalid disposition"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Artifact not found in this project"),
    503: errorResponse("Storage is not configured or unreachable"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentArtifact",
  path: "/{projectId}/{artifactId}",
  tags: ["Agent Layer"],
  summary: "Delete an artifact",
  description:
    "Removes the object from storage (a missing object is ignored) and then the record. Requires project:update, the same gate as document deletion.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: artifactParams },
  responses: {
    200: jsonResponse("The deleted artifact's id", deleteResultSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Artifact not found in this project"),
    503: errorResponse("Storage delete failed; the record was kept"),
  },
});

const agentArtifact = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(presignRoute, async (c) =>
    c.json(
      await presignArtifact({
        ...c.req.valid("json"),
        projectId: c.req.valid("param").projectId,
        workspaceId: c.get("workspaceId"),
        uploader: { userId: c.get("userId") },
      }),
      200,
    ),
  )
  .openapi(finalizeRoute, async (c) =>
    c.json(
      await finalizeArtifact({
        ...c.req.valid("json"),
        projectId: c.req.valid("param").projectId,
      }),
      200,
    ),
  )
  .openapi(listRoute, async (c) =>
    c.json(
      await listArtifacts(
        c.req.valid("param").projectId,
        c.req.valid("query").taskId,
      ),
      200,
    ),
  )
  .openapi(urlRoute, async (c) => {
    const { projectId, artifactId } = c.req.valid("param");
    return c.json(
      await getArtifactUrl({
        projectId,
        artifactId,
        disposition: c.req.valid("query").disposition,
      }),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const { projectId, artifactId } = c.req.valid("param");
    return c.json(await deleteArtifact(projectId, artifactId), 200);
  });

export default agentArtifact;
