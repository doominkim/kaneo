import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { throwAgentLayerError } from "./api-error";
import type { AgentProjectSettings } from "./get-agent-project-settings";

export type PutAgentProjectSettingsBody = InferRequestType<
  (typeof client)["agent-project"][":projectId"]["$put"]
>["json"];

export type PutAgentProjectSettingsRequest = {
  projectId: string;
  body: PutAgentProjectSettingsBody;
};

async function putAgentProjectSettings({
  projectId,
  body,
}: PutAgentProjectSettingsRequest): Promise<AgentProjectSettings> {
  const response = await client["agent-project"][":projectId"].$put({
    param: { projectId },
    json: body,
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default putAgentProjectSettings;
