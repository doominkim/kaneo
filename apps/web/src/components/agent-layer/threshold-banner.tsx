import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AgentTree } from "@/fetchers/agent-layer/get-agent-tree";

type ThresholdBannerProps = {
  projectId: string;
  threshold: AgentTree["threshold"];
};

/**
 * §6.1: open tasks above `active_task_threshold` mean the working set is
 * bloating. The verdict comes from the server; this only renders it.
 */
export function ThresholdBanner({
  projectId,
  threshold,
}: ThresholdBannerProps) {
  const { t } = useTranslation();
  if (!threshold.exceeded) return null;

  return (
    <Alert variant="warning" data-testid="threshold-banner">
      <TriangleAlert />
      <AlertTitle>
        {t("agentLayer:overview.thresholdExceeded", {
          open: threshold.openTotal,
          threshold: threshold.activeTaskThreshold,
        })}
      </AlertTitle>
      <AlertDescription>
        <span>{t("agentLayer:overview.thresholdHint")}</span>
        <Link
          to="/dashboard/settings/projects/$projectId/agent-layer"
          params={{ projectId }}
          className="w-fit font-medium text-foreground underline underline-offset-2"
        >
          {t("agentLayer:overview.thresholdSettingsLink")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
