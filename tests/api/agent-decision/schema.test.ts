import { describe, expect, it } from "vitest";
import {
  acceptDecisionBody,
  createDecisionBody,
  listDecisionsQuery,
  updateDecisionBody,
} from "../../../apps/api/src/agent-decision/schema";

const base = {
  projectId: "project-1",
  title: "Redis를 선택 의존성으로 유지한다",
  context: "단일 인스턴스 설치를 단순하게 유지해야 한다.",
  decision: "Redis 없이도 실행되는 인메모리 경로를 유지한다.",
};

describe("ADR 요청 스키마", () => {
  it("사람 초안과 에이전트 초안을 구분하고 모델 식별자 쌍을 강제한다", () => {
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

  it("초안 수정에 동시성 토큰과 실제 변경 필드를 요구한다", () => {
    const expectedUpdatedAt = "2026-09-11T00:00:00.000Z";
    expect(updateDecisionBody.safeParse({ expectedUpdatedAt }).success).toBe(
      false,
    );
    expect(
      updateDecisionBody.safeParse({ expectedUpdatedAt, title: "새 제목" })
        .success,
    ).toBe(true);
  });

  it("채택에 동시성 토큰을 요구하고 목록은 현재 상태를 기본값으로 쓴다", () => {
    expect(acceptDecisionBody.safeParse({}).success).toBe(false);
    expect(
      acceptDecisionBody.safeParse({
        expectedUpdatedAt: "2026-09-11T00:00:00.000Z",
        supersedesDecisionId: "old-adr",
      }).success,
    ).toBe(true);
    expect(listDecisionsQuery.parse({})).toMatchObject({
      limit: 20,
      status: "current",
    });
  });
});
