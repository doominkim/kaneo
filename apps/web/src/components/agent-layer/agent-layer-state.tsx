import { AlertTriangle, FileQuestion, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";

type AgentLayerErrorStateProps = {
  error: unknown;
  onRetry?: () => void;
};

/** Maps a fetch failure to the 403 / 404 / generic states every tab shares. */
export function AgentLayerErrorState({
  error,
  onRetry,
}: AgentLayerErrorStateProps) {
  const { t } = useTranslation();

  const state = isAgentLayerStatus(error, 403)
    ? {
        icon: Lock,
        title: t("agentLayer:common.forbiddenTitle"),
        description: t("agentLayer:common.forbiddenDescription"),
        retry: false,
      }
    : isAgentLayerStatus(error, 404)
      ? {
          icon: FileQuestion,
          title: t("agentLayer:common.notFoundTitle"),
          description: t("agentLayer:common.notFoundDescription"),
          retry: false,
        }
      : {
          icon: AlertTriangle,
          title: t("agentLayer:common.errorTitle"),
          description: t("agentLayer:common.errorDescription"),
          retry: true,
        };

  const Icon = state.icon;

  return (
    <Empty className="py-12" data-testid="agent-layer-error">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{state.title}</EmptyTitle>
        <EmptyDescription>{state.description}</EmptyDescription>
      </EmptyHeader>
      {state.retry && onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("agentLayer:common.retry")}
        </Button>
      ) : null}
    </Empty>
  );
}

type AgentLayerEmptyProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function AgentLayerEmpty({
  title,
  description,
  action,
}: AgentLayerEmptyProps) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action}
    </Empty>
  );
}

export function AgentLayerSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          // Static placeholder rows have no identity beyond their position.
          key={`skeleton-${index.toString()}`}
          className="h-10 w-full"
        />
      ))}
    </div>
  );
}
