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
  it("[REQ-SPEC-TABS-1] orders the tabs 개요·타임라인·요구사항·설계·태스크·지식·문서", () => {
    expect(SECTIONS.map((section) => section.section)).toEqual([
      "overview",
      "timeline",
      "requirements",
      "design",
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
      "agentLayer:nav.requirements",
      "agentLayer:nav.design",
      "agentLayer:nav.tasks",
      "agentLayer:nav.knowledge",
      "agentLayer:nav.docs",
    ]);
  });

  it("[REQ-SPEC-TABS-1] resolves the requirements and design URLs to their own sections", () => {
    expect(
      resolveProjectView("/dashboard/workspace/ws/project/p1/requirements"),
    ).toBe("requirements");
    expect(
      resolveProjectView(
        "/dashboard/workspace/ws/project/p1/requirements/spec-tabs",
      ),
    ).toBe("requirements");
    expect(
      resolveProjectView("/dashboard/workspace/ws/project/p1/design/spec-tabs"),
    ).toBe("design");
    expect(sectionOfView("requirements")).toBe("requirements");
    expect(sectionOfView("design")).toBe("design");
  });

  it("[REQ-SPEC-TABS-1] clicking a tab navigates to that view", () => {
    const onSelectView = vi.fn();
    render(
      <ProjectSectionTabs activeView="board" onSelectView={onSelectView} />,
    );
    fireEvent.click(screen.getByText("agentLayer:nav.requirements"));
    fireEvent.click(screen.getByText("agentLayer:nav.design"));
    expect(onSelectView.mock.calls.map((call) => call[0])).toEqual([
      "requirements",
      "design",
    ]);
  });
});
