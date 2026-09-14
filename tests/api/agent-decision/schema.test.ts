import { describe, expect, it } from "vitest";
import {
  createDecisionBody,
  listDecisionsQuery,
} from "../../../apps/api/src/agent-decision/schema";

const base = {
  projectId: "project-1",
  title: "Redis를 선택 의존성으로 유지한다",
  context: "단일 인스턴스 설치를 단순하게 유지해야 한다.",
  decision: "Redis 없이도 실행되는 인메모리 경로를 유지한다.",
};

describe("ADR 요청 스키마", () => {
  it("사람 작성과 에이전트 작성을 구분하고 모델 식별자 쌍을 강제한다", () => {
    expect(createDecisionBody.safeParse(base).success).toBe(true);
    expect(
      createDecisionBody.safeParse({
        ...base,
        provider: "openai",
        model: "gpt-6",
      }).success,
    ).toBe(true);
    expect(
      createDecisionBody.safeParse({ ...base, provider: "openai" }).success,
    ).toBe(false);
  });

  it("빈 핵심 필드와 중복 태스크 연결을 거부한다", () => {
    expect(
      createDecisionBody.safeParse({ ...base, context: "   " }).success,
    ).toBe(false);
    expect(
      createDecisionBody.safeParse({
        ...base,
        taskIds: ["task-1", "task-1"],
      }).success,
    ).toBe(false);
  });

  it("ADR 본문 전체를 200KB로 제한한다", () => {
    expect(
      createDecisionBody.safeParse({
        ...base,
        context: "가".repeat(70_000),
      }).success,
    ).toBe(false);
  });

  it("[REQ-AGENT-AUTOAPPLY-19] 생성 요청이 대체할 ADR id 를 선택적으로 받는다", () => {
    expect(
      createDecisionBody.safeParse({ ...base, supersedesDecisionId: "old-adr" })
        .success,
    ).toBe(true);
    expect(
      createDecisionBody.safeParse({ ...base, supersedesDecisionId: "" })
        .success,
    ).toBe(false);
  });

  it("[REQ-AGENT-AUTOAPPLY-3] 목록 기본값은 current 이고 draft 필터는 없으며 deleted 필터가 있다", () => {
    expect(listDecisionsQuery.parse({})).toMatchObject({
      limit: 20,
      status: "current",
    });
    expect(listDecisionsQuery.safeParse({ status: "draft" }).success).toBe(
      false,
    );
    expect(listDecisionsQuery.parse({ status: "deleted" }).status).toBe(
      "deleted",
    );
  });
});
