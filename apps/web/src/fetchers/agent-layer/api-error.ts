/**
 * The agent-layer views distinguish 403 (no workspace access) and 404 (unknown
 * slug/entry) in the UI, so the status has to survive the throw. Other fetchers
 * collapse everything into `new Error(text)`, which loses it.
 */
export class AgentLayerApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message || `Request failed with status ${status}`);
    this.name = "AgentLayerApiError";
    this.status = status;
  }
}

export async function throwAgentLayerError(response: Response): Promise<never> {
  const text = await response.text();
  throw new AgentLayerApiError(response.status, text);
}

export function isAgentLayerStatus(error: unknown, status: number) {
  return error instanceof AgentLayerApiError && error.status === status;
}
