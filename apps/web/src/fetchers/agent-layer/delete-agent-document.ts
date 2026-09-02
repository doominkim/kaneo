import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";

async function deleteAgentDocument(projectId: string, slug: string) {
  const response = await client["agent-document"][":projectId"][
    ":slug"
  ].$delete({
    param: { projectId, slug },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default deleteAgentDocument;
