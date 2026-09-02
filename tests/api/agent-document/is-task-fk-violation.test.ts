import { describe, expect, it } from "vitest";
import { isTaskForeignKeyViolation } from "../../../apps/api/src/agent-document/controllers/is-task-fk-violation";

function pgError(code: string, constraint: string) {
  return Object.assign(new Error("violation"), { code, constraint });
}

describe("isTaskForeignKeyViolation", () => {
  it("matches a raw pg error on the task constraint", () => {
    expect(
      isTaskForeignKeyViolation(
        pgError("23503", "agent_document_task_id_task_id_fk"),
      ),
    ).toBe(true);
  });

  it("matches the same error wrapped as a drizzle query error cause", () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: pgError("23503", "agent_document_task_id_task_id_fk"),
    });
    expect(isTaskForeignKeyViolation(wrapped)).toBe(true);
  });

  it("ignores other constraints, other codes, and non-errors", () => {
    expect(
      isTaskForeignKeyViolation(
        pgError("23503", "agent_document_project_id_project_id_fk"),
      ),
    ).toBe(false);
    expect(
      isTaskForeignKeyViolation(
        pgError("23505", "agent_document_task_id_task_id_fk"),
      ),
    ).toBe(false);
    expect(isTaskForeignKeyViolation(null)).toBe(false);
    expect(isTaskForeignKeyViolation("23503")).toBe(false);
  });
});
