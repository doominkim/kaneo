import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MobileProjectSections,
  ProjectSectionTabs,
  resolveProjectView,
  SECTIONS,
  sectionOfView,
} from "./project-view-nav";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

describe("project sections", () => {
  it("[REQ-SPEC-TABS-1] [REQ-FEATURE-HUB-1] orders the tabs 개요·타임라인·Feature·태스크·지식·문서", () => {
    expect(SECTIONS.map((section) => section.section)).toEqual([
      "overview",
      "timeline",
      "feature",
      "tasks",
      "knowledge",
      "docs",
    ]);
    render(<ProjectSectionTabs activeView="board" onSelectView={() => {}} />);
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual([
      "agentLayer:nav.overview",
      "agentLayer:nav.timeline",
      "agentLayer:nav.feature",
      "agentLayer:nav.tasks",
      "agentLayer:nav.knowledge",
      "agentLayer:nav.docs",
    ]);
  });

  it("[REQ-FEATURE-HUB-1] resolves feature URLs to the Feature section", () => {
    expect(
      resolveProjectView("/dashboard/workspace/ws/project/p1/feature"),
    ).toBe("feature");
    expect(
      resolveProjectView(
        "/dashboard/workspace/ws/project/p1/feature/spec-tabs",
      ),
    ).toBe("feature");
    expect(sectionOfView("feature")).toBe("feature");
  });

  it("[REQ-FEATURE-HUB-1] clicking a tab navigates to that view", () => {
    const onSelectView = vi.fn();
    render(
      <ProjectSectionTabs activeView="board" onSelectView={onSelectView} />,
    );
    fireEvent.click(screen.getByText("agentLayer:nav.feature"));
    fireEvent.click(screen.getByText("agentLayer:nav.docs"));
    expect(onSelectView.mock.calls.map((call) => call[0])).toEqual([
      "feature",
      "docs",
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-10] shows the unreviewed count on the Feature and knowledge tabs, and nothing at zero", () => {
    render(
      <ProjectSectionTabs
        activeView="board"
        onSelectView={() => {}}
        badges={{ feature: 2, knowledge: 5, docs: 0 }}
      />,
    );
    const countOn = (label: string) =>
      screen
        .getByText(label)
        .closest("button")
        ?.querySelector('[data-testid="unreviewed-count"] [aria-hidden="true"]')
        ?.textContent ?? null;
    expect(countOn("agentLayer:nav.feature")).toBe("2");
    expect(countOn("agentLayer:nav.knowledge")).toBe("5");
    expect(countOn("agentLayer:nav.docs")).toBeNull();
    const counts = screen.getAllByTestId("unreviewed-count");
    expect(counts).toHaveLength(2);
    // Announced with its meaning, not as a bare digit.
    expect(counts[0]).toHaveTextContent("agentLayer:common.unreviewedCount");
  });

  it("[REQ-AGENT-AUTOAPPLY-10] the mobile section grid carries the same counts", () => {
    render(
      <MobileProjectSections
        activeView="board"
        onSelectView={() => {}}
        badges={{ knowledge: 3 }}
      />,
    );
    const counts = screen.getAllByTestId("unreviewed-count");
    expect(counts).toHaveLength(1);
    expect(counts[0].closest("button")).toHaveTextContent(
      "agentLayer:nav.knowledge",
    );
  });
});
