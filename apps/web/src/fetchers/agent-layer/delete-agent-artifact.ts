import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";

async function deleteAgentArtifact(projectId: string, artifactId: string) {
  const response = await client["agent-artifact"][":projectId"][
    ":artifactId"
  ].$delete({
    param: { projectId, artifactId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default deleteAgentArtifact;
