import { eq } from "drizzle-orm";
import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import presignArtifact from "../agent-artifact/controllers/presign-artifact";
import putTextArtifact from "../agent-artifact/controllers/put-text-artifact";
import putDocument from "../agent-document/controllers/put-document";
import createDomain from "../agent-domain/controllers/create-domain";
import updateDomain from "../agent-domain/controllers/update-domain";
import resolveActor from "../agent-entry/controllers/resolve-actor";
import db, { schema } from "../database";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

/**
 * In-process write path for the MCP agent tools that must be attributed to an
 * agent (`actorId`) rather than to the human whose token the session carries.
 *
 * Why not HTTP like the other tools: the MCP layer calls the API with the
 * caller's own session bearer, and an MCP-issued token is a plain `session`
 * row (see `oauth.ts#exchangeCode`). The API therefore cannot tell an MCP
 * tool call from `curl` with the same token, so any header or body flag that
 * asked for agent attribution would be settable by any HTTP client. Calling
 * the controllers directly keeps `actorId` unreachable from the public API:
 * the only code that can produce one is this module, and the only caller of
 * this module is the MCP handler after `validateBearerToken`.
 *
 * Authorization is re-done here with the same primitives the HTTP routes use
 * (`validateWorkspaceAccess`, `hasWorkspacePermission`) — not a copy of them.
 * `hasWorkspacePermission` reads its inputs from a Hono context, so a bare
 * `Context` is built for it. MCP sessions are never API keys (the bearer is
 * validated with `auth.api.getSession`), so `apiKey` is intentionally unset.
 */

type AgentIdentity = {
  userId: string;
  provider: string;
  model: string;
};

type AgentPrincipal = AgentIdentity & { projectId: string };
type AgentWorkspacePrincipal = AgentIdentity & { workspaceId: string };

export type AgentWriteAuthorization = {
  workspaceId: string;
  actorId: string;
};

const REQUIRED = { task: ["update"] };

/**
 * Workspace-scoped variant: the caller names the workspace directly (domain
 * pages are workspace-level, there is no project to derive it from). Access
 * and task:update are checked exactly as for a project write; a caller who
 * is refused never gets an actor row minted.
 */
export async function authorizeAgentWorkspaceWrite(
  principal: AgentWorkspacePrincipal,
): Promise<AgentWriteAuthorization> {
  await validateWorkspaceAccess(principal.userId, principal.workspaceId);

  const c = new Context(new Request("http://kaneo.internal/mcp/agent-write"));
  c.set("userId", principal.userId);
  c.set("workspaceId", principal.workspaceId);
  if (!(await hasWorkspacePermission(c, REQUIRED))) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }

  const actor = await resolveActor(
    principal.workspaceId,
    principal.userId,
    principal.provider,
    principal.model,
  );
  if (!actor) {
    throw new HTTPException(500, { message: "Failed to resolve agent actor" });
  }
  return { workspaceId: principal.workspaceId, actorId: actor.id };
}

export async function authorizeAgentWrite(
  principal: AgentPrincipal,
): Promise<AgentWriteAuthorization> {
  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, principal.projectId))
    .limit(1);
  if (!project) {
    // Same wording as the workspace-access middleware, for the same case.
    throw new HTTPException(400, {
      message: "Workspace ID could not be determined",
    });
  }
  return authorizeAgentWorkspaceWrite({
    ...principal,
    workspaceId: project.workspaceId,
  });
}

/**
 * Tool results must read the same whether the failure came over HTTP or from
 * here: `"<status> <message>"`, as `Api.json` in agent-tools produces.
 */
async function asToolCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw new Error(`${error.status} ${error.message}`);
    }
    throw error;
  }
}

export function putDocumentAsAgent(
  input: AgentPrincipal & {
    slug: string;
    title: string;
    body: string;
    taskId?: string | null;
    domainId?: string | null;
  },
) {
  return asToolCall(async () => {
    const auth = await authorizeAgentWrite(input);
    return putDocument({
      workspaceId: auth.workspaceId,
      projectId: input.projectId,
      slug: input.slug,
      title: input.title,
      body: input.body,
      taskId: input.taskId,
      domainId: input.domainId,
      author: { actorId: auth.actorId },
    });
  });
}

/**
 * Upsert of a domain page as an agent: with `domainId` the page's title/body
 * are replaced, without it a new page is created under `parentId` (or at the
 * root) with `slug`. Both branches attribute the write to the resolved actor.
 */
export function putDomainAsAgent(
  input: AgentWorkspacePrincipal & {
    domainId?: string | null;
    parentId?: string | null;
    slug?: string | null;
    title: string;
    body: string;
  },
) {
  return asToolCall(async () => {
    const auth = await authorizeAgentWorkspaceWrite(input);
    if (input.domainId) {
      return updateDomain({
        workspaceId: auth.workspaceId,
        domainId: input.domainId,
        title: input.title,
        body: input.body,
        author: { actorId: auth.actorId },
      });
    }
    if (!input.slug) {
      throw new HTTPException(400, {
        message: "slug is required when creating a page",
      });
    }
    return createDomain({
      workspaceId: auth.workspaceId,
      parentId: input.parentId,
      slug: input.slug,
      title: input.title,
      body: input.body,
      author: { actorId: auth.actorId },
    });
  });
}

export function presignArtifactAsAgent(
  input: AgentPrincipal & {
    name: string;
    contentType: string;
    size: number;
    taskId?: string | null;
  },
) {
  return asToolCall(async () => {
    const auth = await authorizeAgentWrite(input);
    return presignArtifact({
      workspaceId: auth.workspaceId,
      projectId: input.projectId,
      uploader: { actorId: auth.actorId },
      name: input.name,
      contentType: input.contentType,
      size: input.size,
      taskId: input.taskId,
    });
  });
}

export function putTextArtifactAsAgent(
  input: AgentPrincipal & {
    name: string;
    contentType: string;
    text: string;
    taskId?: string | null;
  },
) {
  return asToolCall(async () => {
    const auth = await authorizeAgentWrite(input);
    return putTextArtifact({
      workspaceId: auth.workspaceId,
      projectId: input.projectId,
      actorId: auth.actorId,
      name: input.name,
      contentType: input.contentType,
      text: input.text,
      taskId: input.taskId,
    });
  });
}
