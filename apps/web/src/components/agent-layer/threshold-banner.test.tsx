import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThresholdBanner } from "./threshold-banner";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children: React.ReactNode;
    params: Record<string, string>;
    to: string;
  }) => (
    <a href={to} data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
}));
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

afterEach(() => cleanup());

describe("ThresholdBanner", () => {
  it("renders nothing while the open count is within the threshold", () => {
    render(
      <ThresholdBanner
        projectId="p"
        threshold={{ activeTaskThreshold: 20, openTotal: 3, exceeded: false }}
      />,
    );
    expect(screen.queryByTestId("threshold-banner")).not.toBeInTheDocument();
  });

  it("warns with the live counts and links to the project's agent-layer settings", () => {
    render(
      <ThresholdBanner
        projectId="p"
        threshold={{ activeTaskThreshold: 2, openTotal: 5, exceeded: true }}
      />,
    );
    const banner = screen.getByTestId("threshold-banner");
    expect(banner).toHaveTextContent(
      "agentLayer:overview.thresholdExceeded open=5 threshold=2",
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/settings/projects/$projectId/agent-layer",
    );
    expect(link).toHaveAttribute(
      "data-params",
      JSON.stringify({ projectId: "p" }),
    );
  });
});
