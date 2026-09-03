import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import { CreateDomainDialog } from "./create-domain-dialog";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options
        ? `${key} ${Object.entries(options)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(" ")}`
        : key,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/hooks/mutations/agent-layer/use-create-agent-domain", () => ({
  useCreateAgentDomain: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
}));

function renderDialog(parent: { id: string; title: string } | null = null) {
  const onCreated = vi.fn();
  render(
    <CreateDomainDialog
      open
      onOpenChange={vi.fn()}
      workspaceId="ws"
      parent={parent}
      onCreated={onCreated}
    />,
  );
  return { onCreated };
}

beforeEach(() => {
  mocks.create.mockReset();
});

afterEach(() => cleanup());

describe("CreateDomainDialog", () => {
  it("derives the slug from a Latin title and submits it", async () => {
    mocks.create.mockResolvedValue({ id: "d1" });
    const { onCreated } = renderDialog();
    fireEvent.change(screen.getByLabelText("agentLayer:domain.titleLabel"), {
      target: { value: "Inbound Records" },
    });
    expect(screen.getByTestId("slug-preview")).toHaveTextContent(
      "inbound-records",
    );
    fireEvent.click(screen.getByTestId("create-domain-submit"));
    await vi.waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        workspaceId: "ws",
        body: {
          parentId: null,
          slug: "inbound-records",
          title: "Inbound Records",
          body: "",
        },
      }),
    );
    expect(onCreated).toHaveBeenCalledWith({ id: "d1" });
  });

  it("falls back to domain-xxxxxx for a Korean-only title, under the parent", async () => {
    mocks.create.mockResolvedValue({ id: "d2" });
    renderDialog({ id: "d-pharmacy", title: "약국" });
    fireEvent.change(screen.getByLabelText("agentLayer:domain.titleLabel"), {
      target: { value: "약사" },
    });
    const preview = screen.getByTestId("slug-preview").textContent ?? "";
    expect(preview).toMatch(/^domain-[a-z0-9]{6}$/);
    fireEvent.click(screen.getByTestId("create-domain-submit"));
    await vi.waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        workspaceId: "ws",
        body: {
          parentId: "d-pharmacy",
          slug: preview,
          title: "약사",
          body: "",
        },
      }),
    );
  });

  it("keeps a hand-edited slug when the title changes again", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("slug-toggle"));
    fireEvent.change(screen.getByLabelText("agentLayer:domain.slugLabel"), {
      target: { value: "Pharmacy" },
    });
    fireEvent.change(screen.getByLabelText("agentLayer:domain.titleLabel"), {
      target: { value: "약국 본점" },
    });
    expect(screen.getByTestId("slug-preview")).toHaveTextContent("pharmacy");
  });

  it("surfaces a sibling slug clash from the 409 and opens the slug field", async () => {
    mocks.create.mockRejectedValue(new AgentLayerApiError(409, "taken"));
    renderDialog();
    fireEvent.change(screen.getByLabelText("agentLayer:domain.titleLabel"), {
      target: { value: "Pharmacy" },
    });
    fireEvent.click(screen.getByTestId("create-domain-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "agentLayer:domain.slugExists",
    );
    expect(screen.getByLabelText("agentLayer:domain.slugLabel")).toBeVisible();
  });
});
