import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { throwAgentLayerError } from "./api-error";
import type { AgentDocument } from "./get-agent-document";

export type PutAgentDocumentBody = InferRequestType<
  (typeof client)["agent-document"][":projectId"][":slug"]["$put"]
>["json"];

export type PutAgentDocumentRequest = {
  projectId: string;
  slug: string;
  body: PutAgentDocumentBody;
};

async function putAgentDocument({
  projectId,
  slug,
  body,
}: PutAgentDocumentRequest): Promise<AgentDocument> {
  const response = await client["agent-document"][":projectId"][":slug"].$put({
    param: { projectId, slug },
    json: body,
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default putAgentDocument;
