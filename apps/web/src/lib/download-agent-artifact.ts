import getAgentArtifactUrl from "@/fetchers/agent-layer/get-agent-artifact-url";

/**
 * Mints an attachment URL and hands it to the browser. The server pins
 * `Content-Disposition: attachment`, so navigating to it downloads without
 * leaving the page; no bytes ever pass through the app.
 */
export async function downloadAgentArtifact(
  projectId: string,
  artifactId: string,
) {
  const { url } = await getAgentArtifactUrl(
    projectId,
    artifactId,
    "attachment",
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
