import { Link } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentDocumentSummary } from "@/fetchers/agent-layer/get-agent-documents";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { AgentLayerEmpty } from "./agent-layer-state";

type DocumentListProps = {
  documents: AgentDocumentSummary[];
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  taskNumberById: Map<string, number | null>;
  memberNameById: Map<string, string>;
  canCreate: boolean;
  onCreate: () => void;
};

export function DocumentList({
  documents,
  workspaceId,
  projectId,
  projectSlug,
  taskNumberById,
  memberNameById,
  canCreate,
  onCreate,
}: DocumentListProps) {
  const { t } = useTranslation();

  const createButton = canCreate ? (
    <Button size="sm" onClick={onCreate} data-testid="new-document">
      <Plus className="size-3.5" />
      {t("agentLayer:docs.new")}
    </Button>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        <h1 className="text-sm font-semibold text-foreground">
          {t("agentLayer:docs.title")}
        </h1>
        {createButton}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4">
        {documents.length === 0 ? (
          <AgentLayerEmpty
            title={t("agentLayer:docs.empty")}
            description={t("agentLayer:docs.emptyHint")}
          />
        ) : (
          <div className="mx-auto max-w-4xl overflow-x-auto rounded-lg border border-border/80 bg-background">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-3 py-2">
                    {t("agentLayer:docs.columnTitle")}
                  </th>
                  <th className="px-3 py-2">
                    {t("agentLayer:docs.columnTask")}
                  </th>
                  <th className="px-3 py-2">
                    {t("agentLayer:docs.columnAuthor")}
                  </th>
                  <th className="px-3 py-2">
                    {t("agentLayer:docs.columnUpdated")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {documents.map((document) => {
                  const taskNumber = document.taskId
                    ? taskNumberById.get(document.taskId)
                    : undefined;
                  const author = document.updatedBy
                    ? (memberNameById.get(document.updatedBy) ??
                      document.updatedBy)
                    : null;
                  return (
                    <tr
                      key={document.id}
                      data-testid="document-row"
                      className="transition-colors hover:bg-muted/60"
                    >
                      <td className="px-3 py-2">
                        <Link
                          to="/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug"
                          params={{
                            workspaceId,
                            projectId,
                            slug: document.slug,
                          }}
                          className="flex min-w-0 items-center gap-2 font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{document.title}</span>
                          <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                            {document.slug}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {document.taskId ? (
                          <Link
                            to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                            params={{
                              workspaceId,
                              projectId,
                              taskId: document.taskId,
                            }}
                            className="underline-offset-2 hover:underline"
                          >
                            {projectSlug ? `${projectSlug}-` : "#"}
                            {taskNumber ?? "?"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {author ?? (
                          <Badge
                            variant="info"
                            size="sm"
                            data-testid="agent-author"
                          >
                            {t("agentLayer:common.agent")}
                          </Badge>
                        )}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground"
                        title={formatDateTime(document.updatedAt)}
                      >
                        {formatRelativeTime(document.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
