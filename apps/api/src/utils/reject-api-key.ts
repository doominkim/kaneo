import { HTTPException } from "hono/http-exception";

/**
 * Structural rather than a Hono `Context`: route handlers carry route-specific
 * context generics, and all this needs is the `apiKey` variable.
 */
type ApiKeyContext = { get: (key: "apiKey") => unknown };

/**
 * Refuses API-key callers on the actions that record a person's judgement
 * after an agent write applied (agent-autoapply): review, delete, restore and
 * revert. A key carries its owner's permissions but not proof that anyone
 * looked, so these stay session-only even for a caller who holds the role.
 */
export function rejectApiKey(c: ApiKeyContext) {
  if (c.get("apiKey")) {
    throw new HTTPException(403, {
      message:
        "Review, delete, restore and revert are human actions: sign in with a session, not an API key",
    });
  }
}
