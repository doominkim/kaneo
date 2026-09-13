import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { AgentStaleVerdict } from "@/fetchers/agent-layer/agent-designs";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";

/** draft / approved, the only two states a requirement set or design has. */
export function SpecStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const approved = status === "approved";
  return (
    <Badge
      variant={approved ? "success" : "secondary"}
      size="sm"
      data-testid="spec-status"
      data-status={status}
    >
      {approved ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <CircleDashed className="size-3" />
      )}
      {approved
        ? t("agentLayer:spec.statusApproved")
        : t("agentLayer:spec.statusDraft")}
    </Badge>
  );
}

export function StaleBadge({
  stale,
  className,
}: {
  stale: AgentStaleVerdict | boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const isStale = typeof stale === "boolean" ? stale : stale.stale;
  if (!isStale) return null;
  return (
    <Badge
      variant="warning"
      size="sm"
      className={cn(className)}
      data-testid="stale-badge"
    >
      <AlertTriangle className="size-3" />
      {t("agentLayer:spec.stale")}
    </Badge>
  );
}

/** The causes behind a stale verdict, one line each, so the reader knows what to re-check. */
export function StaleCauses({ stale }: { stale: AgentStaleVerdict }) {
  const { t } = useTranslation();
  if (!stale.stale) return null;
  return (
    <div
      className="rounded-md border border-warning/40 bg-warning/8 px-3 py-2 text-xs"
      data-testid="stale-causes"
    >
      <p className="font-medium text-warning-foreground">
        {t("agentLayer:spec.staleHint")}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
        {stale.causes.map((cause) => (
          <li key={`${cause.kind}:${cause.key}`}>
            {cause.kind === "requirement"
              ? t("agentLayer:spec.staleRequirement", {
                  key: cause.key,
                  when: formatRelativeTime(cause.changedAt),
                })
              : t("agentLayer:spec.staleDesign", {
                  key: cause.key,
                  when: formatRelativeTime(cause.changedAt),
                })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RequirementKeyChip({
  requirementKey,
  className,
  muted,
}: {
  requirementKey: string;
  className?: string;
  muted?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn("font-mono", muted && "text-muted-foreground", className)}
      data-testid="requirement-key"
    >
      {requirementKey}
    </Badge>
  );
}
