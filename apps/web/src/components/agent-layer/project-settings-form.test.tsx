import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import type { AgentProjectSettings } from "@/fetchers/agent-layer/get-agent-project-settings";
import { parseCorePaths } from "./core-paths";
import { ProjectSettingsForm } from "./project-settings-form";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options
        ? `${key} ${Object.entries(options)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(" ")}`
        : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));

const settings: AgentProjectSettings = {
  projectId: "p",
  corePaths: ["src/domain/**"],
  activeTaskThreshold: 20,
  doneArchiveDays: 30,
  domainIds: [],
  domains: [],
  configured: true,
  updatedBy: "user-1",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const domainOptions: AgentDomainNode[] = [
  {
    id: "d-pharmacy",
    parentId: null,
    slug: "pharmacy",
    title: "약국",
    position: 0,
    updatedAt: "2026-09-03T00:00:00.000Z",
    childCount: 1,
  },
  {
    id: "d-pharmacist",
    parentId: "d-pharmacy",
    slug: "pharmacist",
    title: "약사",
    position: 0,
    updatedAt: "2026-09-03T00:00:00.000Z",
    childCount: 0,
  },
];

function renderForm(
  overrides: Partial<Parameters<typeof ProjectSettingsForm>[0]> = {},
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectSettingsForm
      settings={settings}
      canEdit
      isSaving={false}
      memberNameById={new Map([["user-1", "Dominic"]])}
      domainOptions={domainOptions}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave };
}

afterEach(() => cleanup());

describe("parseCorePaths", () => {
  it("mirrors the server rules: trims, strips ./, dedupes, rejects absolute and ..", () => {
    const parsed = parseCorePaths(
      [
        "  ./src/domain/**",
        "src/domain/**",
        "",
        "/etc/passwd",
        "C:\\repo\\x",
        "../outside/**",
        "a/../b",
        "x".repeat(201),
        "**/migrations/**",
      ].join("\n"),
    );
    expect(parsed.patterns).toEqual(["src/domain/**", "**/migrations/**"]);
    expect(parsed.issues).toEqual([
      { line: 4, reason: "absolute" },
      { line: 5, reason: "absolute" },
      { line: 6, reason: "parent" },
      { line: 7, reason: "parent" },
      { line: 8, reason: "tooLong" },
    ]);
    expect(parsed.tooMany).toBe(false);
  });

  it("flags more than 50 patterns", () => {
    const text = Array.from({ length: 51 }, (_, i) => `p${i}/**`).join("\n");
    expect(parseCorePaths(text).tooMany).toBe(true);
  });
});

describe("ProjectSettingsForm", () => {
  it("shows the configured state and who saved it last", () => {
    renderForm();
    expect(screen.getByTestId("settings-configured")).toHaveTextContent(
      "agentLayer:settings.configured",
    );
    expect(
      screen.getByText(
        "agentLayer:settings.updatedBy name=Dominic time=2 hours ago",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-read-only")).not.toBeInTheDocument();
  });

  it("reports per-line pattern problems and blocks saving", () => {
    renderForm();
    const textarea = screen.getByLabelText(
      "agentLayer:settings.corePathsLabel",
    );
    fireEvent.change(textarea, {
      target: { value: "src/**\n/abs/path\n../up/**" },
    });

    const alerts = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(alerts).toEqual([
      "agentLayer:settings.validation.absolute line=2 max=200",
      "agentLayer:settings.validation.parent line=3 max=200",
    ]);
    expect(screen.getByTestId("settings-save")).toBeDisabled();
  });

  it("validates the numeric ranges on submit", () => {
    const { onSave } = renderForm();
    fireEvent.change(
      screen.getByLabelText("agentLayer:settings.thresholdLabel"),
      { target: { value: "0" } },
    );
    fireEvent.change(
      screen.getByLabelText("agentLayer:settings.archiveDaysLabel"),
      { target: { value: "400" } },
    );
    fireEvent.click(screen.getByTestId("settings-save"));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "agentLayer:settings.validation.thresholdRange min=1 max=500",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "agentLayer:settings.validation.archiveRange min=1 max=365",
      ),
    ).toBeInTheDocument();
  });

  it("submits the normalised full replacement body", () => {
    const { onSave } = renderForm();
    fireEvent.change(
      screen.getByLabelText("agentLayer:settings.corePathsLabel"),
      { target: { value: "./src/domain/**\n\n**/migrations/**\n" } },
    );
    fireEvent.change(
      screen.getByLabelText("agentLayer:settings.thresholdLabel"),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByTestId("settings-save"));

    expect(onSave).toHaveBeenCalledWith({
      corePaths: ["src/domain/**", "**/migrations/**"],
      activeTaskThreshold: 5,
      doneArchiveDays: 30,
      domainIds: [],
    });
  });

  it("lists the domain tree indented and submits the checked ids in tree order", () => {
    const { onSave } = renderForm();
    const checks = screen.getAllByTestId("domain-check");
    expect(checks.map((el) => el.getAttribute("data-domain-id"))).toEqual([
      "d-pharmacy",
      "d-pharmacist",
    ]);
    expect(screen.getByText("약사").closest("li")).toHaveAttribute(
      "style",
      "padding-left: 1.25rem;",
    );

    // Child first, then parent: the payload still follows the tree order.
    fireEvent.click(checks[1]);
    fireEvent.click(checks[0]);
    fireEvent.click(screen.getByTestId("settings-save"));

    expect(onSave).toHaveBeenCalledWith({
      corePaths: ["src/domain/**"],
      activeTaskThreshold: 20,
      doneArchiveDays: 30,
      domainIds: ["d-pharmacy", "d-pharmacist"],
    });
  });

  it("starts from the saved links and unchecks back to an empty list", () => {
    const { onSave } = renderForm({
      settings: {
        ...settings,
        domainIds: ["d-pharmacist"],
        domains: [{ id: "d-pharmacist", slug: "pharmacist", title: "약사" }],
      },
    });
    const [, pharmacist] = screen.getAllByTestId("domain-check");
    expect(pharmacist).toHaveAttribute("data-checked");
    expect(screen.getByTestId("settings-save")).toBeDisabled();

    fireEvent.click(pharmacist);
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ domainIds: [] }),
    );
  });

  it("renders read-only without project:update", () => {
    renderForm({ canEdit: false });
    expect(screen.getByTestId("settings-read-only")).toBeInTheDocument();
    expect(
      screen.getByLabelText("agentLayer:settings.corePathsLabel"),
    ).toBeDisabled();
    expect(screen.queryByTestId("settings-save")).not.toBeInTheDocument();
    for (const check of screen.getAllByTestId("domain-check")) {
      expect(check).toHaveAttribute("data-disabled");
    }
  });
});
