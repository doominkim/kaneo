import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
});
