import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentProjectSettings = InferResponseType<
  (typeof client)["agent-project"][":projectId"]["$get"],
  200
>;

async function getAgentProjectSettings(
  projectId: string,
): Promise<AgentProjectSettings> {
  const response = await client["agent-project"][":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentProjectSettings;
