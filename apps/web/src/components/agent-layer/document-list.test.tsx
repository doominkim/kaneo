import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDocumentSummary } from "@/fetchers/agent-layer/get-agent-documents";
import { DocumentList } from "./document-list";

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
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 2, 2026",
}));

const documents: AgentDocumentSummary[] = [
  {
    id: "d1",
    slug: "session-report",
    title: "Session report",
    taskId: "t1",
    updatedBy: null,
    actorId: "actor-1",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
  {
    id: "d2",
    slug: "design-packet",
    title: "Design packet",
    taskId: null,
    updatedBy: "user-1",
    actorId: null,
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
];

function renderList(
  overrides: Partial<Parameters<typeof DocumentList>[0]> = {},
) {
  const onCreate = vi.fn();
  render(
    <DocumentList
      documents={documents}
      workspaceId="ws"
      projectId="p"
      projectSlug="KAN"
      taskNumberById={new Map([["t1", 7]])}
      memberNameById={new Map([["user-1", "Dominic"]])}
      canCreate
      onCreate={onCreate}
      {...overrides}
    />,
  );
  return { onCreate };
}

afterEach(() => {
  cleanup();
});

describe("DocumentList", () => {
  it("lists documents with task number, author and links to the document page", () => {
    renderList();

    const rows = screen.getAllByTestId("document-row");
    expect(rows).toHaveLength(2);

    const [agentRow, humanRow] = rows;
    expect(within(agentRow).getByText("Session report")).toBeInTheDocument();
    expect(within(agentRow).getByText("KAN-7")).toBeInTheDocument();
    expect(within(agentRow).getByTestId("agent-author")).toHaveTextContent(
      "agentLayer:common.agent",
    );
    const docLink = within(agentRow).getAllByRole("link")[0];
    expect(docLink).toHaveAttribute(
      "data-params",
      JSON.stringify({
        workspaceId: "ws",
        projectId: "p",
        slug: "session-report",
      }),
    );

    expect(within(humanRow).getByText("Dominic")).toBeInTheDocument();
    expect(within(humanRow).getByText("—")).toBeInTheDocument();
  });

  it("shows the create action only with task:update and forwards the click", () => {
    const { onCreate } = renderList();
    fireEvent.click(screen.getByTestId("new-document"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("hides the create action without task:update", () => {
    renderList({ canCreate: false });
    expect(screen.queryByTestId("new-document")).not.toBeInTheDocument();
  });

  it("renders the empty state without documents", () => {
    renderList({ documents: [] });
    expect(screen.getByText("agentLayer:docs.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("document-row")).not.toBeInTheDocument();
  });
});
