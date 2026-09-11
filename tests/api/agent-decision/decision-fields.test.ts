import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  buildTimelineDecision,
  mapEntryToDecisionDraft,
} from "../../../apps/api/src/agent-decision/controllers/decision-fields";
import { liftDecisionTrace } from "../../../apps/api/src/agent-entry/controllers/entry-fields";

describe("기존 결정의 ADR 승격", () => {
  it("원문 본문을 결과로 단정하지 않고 별도 출처 메모로 보존한다", () => {
    expect(
      mapEntryToDecisionDraft({
        summary: "Redis 경로",
        body: "실험 과정과 당시 운영 메모",
        decision: {
          what: "Redis를 선택 의존성으로 둔다",
          why: "단일 인스턴스 설치가 우선이다",
          rejected: "항상 Redis를 요구한다",
          reversible: true,
        },
        refs: { prs: ["123"] },
      }),
    ).toEqual({
      title: "Redis 경로",
      context: "단일 인스턴스 설치가 우선이다",
      decision: "Redis를 선택 의존성으로 둔다",
      alternatives: "항상 Redis를 요구한다",
      consequences: null,
      sourceNote: "실험 과정과 당시 운영 메모",
      reversible: true,
      refs: { prs: ["123"] },
    });
  });

  it("what과 why가 없는 결정 기록은 승격하지 않는다", () => {
    expect(() =>
      mapEntryToDecisionDraft({
        summary: "불완전",
        body: null,
        decision: { what: "선택" },
        refs: null,
      }),
    ).toThrowError(HTTPException);
  });
});

describe("ADR 타임라인 추적 정보", () => {
  it("기존 decision 필드와 ADR 딥링크 메타데이터를 함께 만든다", () => {
    const payload = buildTimelineDecision(
      {
        title: "Redis 경로",
        context: "설치 단순성",
        decision: "선택 의존성",
        alternatives: "필수 의존성",
        consequences: null,
        sourceNote: null,
        reversible: false,
        refs: null,
      },
      {
        decisionId: "adr-3",
        number: 3,
        status: "accepted",
        supersedesDecisionId: "adr-2",
      },
    );

    expect(payload).toMatchObject({
      what: "선택 의존성",
      why: "설치 단순성",
      rejected: "필수 의존성",
      reversible: false,
      adr: {
        decisionId: "adr-3",
        number: 3,
        status: "accepted",
        supersedesDecisionId: "adr-2",
      },
    });
    expect(liftDecisionTrace(payload)).toEqual({
      adrDecisionId: "adr-3",
      adrNumber: 3,
      adrStatus: "accepted",
    });
  });

  it("일반 결정 기록은 ADR 추적 필드를 null로 유지한다", () => {
    expect(liftDecisionTrace({ what: "x", why: "y" })).toEqual({
      adrDecisionId: null,
      adrNumber: null,
      adrStatus: null,
    });
  });
});
