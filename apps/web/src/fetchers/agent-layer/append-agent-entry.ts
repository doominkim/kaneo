import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { throwAgentLayerError } from "./api-error";
import type { AgentEntrySummary } from "./get-agent-entries";

type AppendAgentEntryBody = InferRequestType<
  (typeof client)["agent-entry"]["$post"]
>["json"];

/**
 * The UI only ever writes HUMAN entries. The API decides authorship by the
 * presence of `provider` + `model`, and rejects `effort`/`agentLabel`/`usage`
 * on a human entry, so those keys are removed from the type rather than
 * merely left undefined: a caller cannot accidentally send them.
 */
export type HumanAgentEntryBody = Omit<
  AppendAgentEntryBody,
  "provider" | "model" | "effort" | "agentLabel" | "usage" | "sessionId"
>;

async function appendAgentEntry(
  body: HumanAgentEntryBody,
): Promise<AgentEntrySummary> {
  const response = await client["agent-entry"].$post({ json: body });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default appendAgentEntry;
