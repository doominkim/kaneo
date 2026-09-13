import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRequirementItem } from "@/fetchers/agent-layer/agent-requirements";
import {
  criterionNumbers,
  isDocMode,
  parseDocForView,
  RequirementDoc,
} from "./requirement-doc";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

const body = `# Feature 허브

배경 문단.

## 1. 목록

**리더로서** 보고 싶다.

1. 시스템은 탭을 6개 보여준다. \`e2e\` REQ-FEATURE-HUB-1
2. Feature 탭을 열면 시스템은 feature 를 한 줄씩 보여준다. \`e2e\` REQ-FEATURE-HUB-2

## 2. 승인

1. ~~설계를 처음 승인하면 시스템은 stale 로 만들지 않는다. \`api\` REQ-FEATURE-HUB-14~~
`;

function item(
  key: string,
  overrides: Partial<AgentRequirementItem> = {},
): AgentRequirementItem {
  return {
    id: key,
    setId: "s1",
    projectId: "p1",
    key,
    seq: 1,
    text: "",
    layer: "e2e",
    status: "active",
    story: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    coverage: [],
    designs: [],
    tasks: [],
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("requirement document view", () => {
  it("[REQ-FEATURE-HUB-20] renders prose as markdown and each criterion as a numbered row with badge and coverage", () => {
    render(
      <RequirementDoc
        body={body}
        items={[
          item("REQ-FEATURE-HUB-1", {
            coverage: [
              {
                repo: "r",
                testPath: "a.test.ts",
                testName: null,
                reportedAt: "2026-09-13T00:00:00.000Z",
              },
            ],
          }),
          item("REQ-FEATURE-HUB-2", {
            designs: [
              { id: "d1", feature: "feature-hub", title: "D", status: "draft" },
            ],
            tasks: [{ id: "t1", number: 4, title: "nav", status: "to-do" }],
          }),
          item("REQ-FEATURE-HUB-14", { status: "dropped" }),
        ]}
        workspaceId="ws"
        projectId="p1"
        projectSlug="KAN"
      />,
    );
    const rows = screen.getAllByTestId("criterion-row");
    expect(rows.map((r) => r.getAttribute("data-key"))).toEqual([
      "REQ-FEATURE-HUB-1",
      "REQ-FEATURE-HUB-2",
      "REQ-FEATURE-HUB-14",
    ]);
    expect(
      screen.getAllByTestId("criterion-number").map((n) => n.textContent),
    ).toEqual(["1.1", "1.2", "2.1"]);
    expect(
      screen.getAllByTestId("criterion-layer").map((n) => n.textContent),
    ).toEqual(["e2e", "e2e", "api"]);
    expect(
      screen
        .getAllByTestId("criterion-covered")
        .map((n) => n.getAttribute("data-covered")),
    ).toEqual(["true", "false", "false"]);
    // Prose survives as markdown, headings included; criterion lines are not duplicated inside it.
    const md = screen
      .getAllByTestId("md")
      .map((n) => n.textContent ?? "")
      .join("\n");
    expect(md).toContain("## 1. 목록");
    expect(md).toContain("배경 문단.");
    expect(md).not.toContain("REQ-FEATURE-HUB-1");
    // Links are folded until asked for.
    expect(screen.queryByTestId("criterion-links")).toBeNull();
    fireEvent.click(
      screen.getAllByTestId("criterion-toggle")[1] as HTMLElement,
    );
    expect(screen.getByTestId("criterion-links").textContent).toContain(
      "design:feature-hub",
    );
    expect(screen.getByTestId("criterion-links").textContent).toContain(
      "KAN-4 nav",
    );
  });

  it("[REQ-FEATURE-HUB-21] splits a criterion at 시스템은 so the condition reads apart from the result", () => {
    render(
      <RequirementDoc body={body} items={[]} workspaceId="ws" projectId="p1" />,
    );
    const conditions = screen
      .getAllByTestId("criterion-condition")
      .map((n) => n.textContent?.trim());
    expect(conditions).toEqual(["Feature 탭을 열면", "설계를 처음 승인하면"]);
    const results = screen
      .getAllByTestId("criterion-result")
      .map((n) => n.textContent);
    expect(results[0]).toBe("시스템은 탭을 6개 보여준다.");
    expect(results[1]).toBe("시스템은 feature 를 한 줄씩 보여준다.");
  });

  it("[REQ-FEATURE-HUB-20] parses numbers per story and detects document mode", () => {
    expect(isDocMode(body)).toBe(true);
    expect(isDocMode("# 제목\n\n배경만.\n1. 산문 목록\n")).toBe(false);
    expect([...criterionNumbers(body)]).toEqual([
      ["REQ-FEATURE-HUB-1", "1.1"],
      ["REQ-FEATURE-HUB-2", "1.2"],
      ["REQ-FEATURE-HUB-14", "2.1"],
    ]);
    const segments = parseDocForView(body);
    expect(
      segments
        .filter((s) => s.kind === "criterion")
        .map((s) => (s.kind === "criterion" ? s.dropped : null)),
    ).toEqual([false, false, true]);
  });
});
