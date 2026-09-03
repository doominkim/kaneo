import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, ExternalLink, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import getAgentArtifactUrl from "@/fetchers/agent-layer/get-agent-artifact-url";
import type { AgentArtifact } from "@/fetchers/agent-layer/get-agent-artifacts";
import { useAgentArtifactUrl } from "@/hooks/queries/agent-layer/use-agent-artifact-url";
import { downloadAgentArtifact } from "@/lib/download-agent-artifact";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import {
  ARTIFACT_KIND_ICONS,
  artifactKindOf,
  formatBytes,
  isFramePreviewable,
  isInlineViewable,
} from "./artifact-kind";

type ArtifactViewerProps = {
  artifact: AgentArtifact;
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  taskNumber?: number | null;
  authorName?: string | null;
};

/**
 * DESIGN.md §6 click behaviour: the file is framed from the storage origin
 * inside `<iframe sandbox="">` — no `allow-same-origin`, no `allow-scripts` —
 * and its bytes never enter the app DOM. The inline URL is minted per open
 * (60s TTL) and re-minted on reload.
 */
export function ArtifactViewer({
  artifact,
  workspaceId,
  projectId,
  projectSlug,
  taskNumber,
  authorName,
}: ArtifactViewerProps) {
  const { t } = useTranslation();
  const inlineCapable = isInlineViewable(artifact.contentType);
  const framePreviewable = isFramePreviewable(artifact.contentType);
  // Only the frame needs a URL up front; the new-tab action mints its own.
  const inline = useAgentArtifactUrl(
    projectId,
    framePreviewable ? artifact.id : undefined,
    "inline",
  );
  const Icon = ARTIFACT_KIND_ICONS[artifactKindOf(artifact.contentType)];

  const handleDownload = async () => {
    try {
      await downloadAgentArtifact(projectId, artifact.id);
    } catch (cause) {
      toast.error(t("agentLayer:docs.downloadFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  // The tab is opened synchronously on the click so popup blockers let it
  // through; the fresh URL is assigned once it arrives.
  const handleOpenInNewTab = async () => {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    try {
      const { url } = await getAgentArtifactUrl(
        projectId,
        artifact.id,
        "inline",
      );
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      popup?.close();
      toast.error(t("agentLayer:docs.viewerUrlFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="artifact-viewer">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/docs"
          params={{ workspaceId, projectId }}
          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          {t("agentLayer:docs.backToList")}
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-foreground">
            {artifact.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatBytes(artifact.size)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {artifact.uploadedBy ? (
            <span>{authorName ?? artifact.uploadedBy}</span>
          ) : (
            <Badge variant="info" size="sm">
              {t("agentLayer:common.agent")}
            </Badge>
          )}
          <span title={formatDateTime(artifact.createdAt)}>
            {formatRelativeTime(artifact.createdAt)}
          </span>
          {artifact.taskId ? (
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
              params={{ workspaceId, projectId, taskId: artifact.taskId }}
              className="font-mono underline-offset-2 hover:underline"
            >
              {projectSlug ? `${projectSlug}-` : "#"}
              {taskNumber ?? "?"}
            </Link>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {inlineCapable ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInNewTab}
              data-testid="open-new-tab"
            >
              <ExternalLink className="size-3.5" />
              {t("agentLayer:docs.openInNewTab")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            data-testid="download-artifact"
          >
            <Download className="size-3.5" />
            {t("agentLayer:docs.download")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-muted/30">
        {!framePreviewable ? (
          <div
            className="flex h-full items-center justify-center p-6"
            data-testid="viewer-fallback"
          >
            <div className="max-w-md space-y-3 text-center">
              <Icon className="mx-auto size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {inlineCapable
                  ? t("agentLayer:docs.viewerPdf")
                  : t("agentLayer:docs.viewerZip")}
              </p>
              <div className="flex justify-center gap-2">
                {inlineCapable ? (
                  <Button size="sm" onClick={handleOpenInNewTab}>
                    <ExternalLink className="size-3.5" />
                    {t("agentLayer:docs.openInNewTab")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={inlineCapable ? "outline" : "default"}
                  onClick={handleDownload}
                >
                  <Download className="size-3.5" />
                  {t("agentLayer:docs.download")}
                </Button>
              </div>
            </div>
          </div>
        ) : inline.isPending ? (
          <div className="p-4">
            <AgentLayerSkeleton rows={6} />
          </div>
        ) : inline.isError ? (
          <AgentLayerErrorState
            error={inline.error}
            onRetry={() => inline.refetch()}
          />
        ) : (
          <div className="relative h-full">
            <iframe
              // Empty sandbox: an opaque origin with no scripts, forms,
              // popups or navigation. Agent-produced HTML is untrusted.
              sandbox=""
              src={inline.data.url}
              title={artifact.name}
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-background"
              data-testid="artifact-frame"
            />
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => inline.refetch()}
              aria-label={t("agentLayer:docs.viewerReload")}
              title={t("agentLayer:docs.viewerReload")}
              className="absolute bottom-3 right-3 shadow-sm"
            >
              <RotateCw className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
