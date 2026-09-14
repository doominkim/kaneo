import { AlertTriangle, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { AgentStaleVerdict } from "@/fetchers/agent-layer/agent-designs";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

/**
 * An agent's write that no person has opened yet (agent-autoapply). It is
 * already in effect; the mark only says nobody has looked.
 */
export function UnreviewedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="info"
      size="sm"
      className={cn(className)}
      data-testid="unreviewed-badge"
    >
      <EyeOff className="size-3" />
      {t("agentLayer:common.unreviewed")}
    </Badge>
  );
}

/** Tab and sidebar count of unreviewed items; nothing at zero. */
export function UnreviewedCount({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  const label = t("agentLayer:common.unreviewedCount", { count });
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm bg-info/12 px-1 text-[10px] font-medium tabular-nums text-info-foreground",
        className,
      )}
      title={label}
      data-testid="unreviewed-count"
    >
      {/* A bare number next to a tab label says nothing on its own. */}
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

/** Who deleted an item and when, for the rows of a deleted filter. */
export function DeletedStamp({
  deletedAt,
  deletedByName,
  className,
}: {
  deletedAt: string;
  deletedByName: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn("text-xs text-muted-foreground", className)}
      title={formatDateTime(deletedAt)}
      data-testid="deleted-stamp"
    >
      {t("agentLayer:common.deletedBy", {
        name: deletedByName || t("agentLayer:common.unknownAuthor"),
        when: formatRelativeTime(deletedAt),
      })}
    </span>
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
        {t("agentLayer:spec.staleSinceRevision")}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
        {stale.causes.map((cause) => (
          <li key={`${cause.kind}:${cause.key}`}>
            {cause.kind === "requirement"
              ? t("agentLayer:spec.staleRequirement", {
                  key: cause.key,
                  when: formatRelativeTime(cause.changedAt),
                })
              : t("agentLayer:spec.staleDesignRevised", {
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
