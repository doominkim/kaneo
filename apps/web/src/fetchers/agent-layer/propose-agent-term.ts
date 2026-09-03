import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { throwAgentLayerError } from "./api-error";
import type { AgentTerm } from "./get-agent-terms";

export type ProposeAgentTermBody = InferRequestType<
  (typeof client)["agent-term"]["$post"]
>["json"];

async function proposeAgentTerm(
  body: ProposeAgentTermBody,
): Promise<AgentTerm> {
  const response = await client["agent-term"].$post({ json: body });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default proposeAgentTerm;
