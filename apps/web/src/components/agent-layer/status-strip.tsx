import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleDot, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentLease } from "@/fetchers/agent-layer/get-agent-leases";
import type { AgentTreeNode } from "@/fetchers/agent-layer/get-agent-tree";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type StatusStripProps = {
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  openCount: number;
  doneCount: number;
  leases: AgentLease[];
  tasksById: Map<string, AgentTreeNode>;
};

/** Live section: open/done counts and who is holding what (DESIGN.md §6 item 3). */
export function StatusStrip({
  workspaceId,
  projectId,
  projectSlug,
  openCount,
  doneCount,
  leases,
  tasksById,
}: StatusStripProps) {
  const { t } = useTranslation();

  return (
    <section
      data-testid="status-strip"
      className="grid gap-3 sm:grid-cols-[auto_auto_1fr]"
    >
      <Counter
        icon={<CircleDot className="size-4 text-info-foreground" />}
        label={t("agentLayer:overview.openTasks")}
        value={openCount}
      />
      <Counter
        icon={<CircleCheck className="size-4 text-success-foreground" />}
        label={t("agentLayer:overview.doneTasks")}
        value={doneCount}
      />
      <div className="min-w-0 rounded-lg border border-border/80 bg-background px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Lock className="size-3" />
          {t("agentLayer:overview.leasesTitle")}
        </p>
        {leases.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agentLayer:overview.noLeases")}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {leases.map((lease) => {
              const task = tasksById.get(lease.taskId);
              const taskLabel = task
                ? `${projectSlug ? `${projectSlug}-` : "#"}${task.number ?? "?"} ${task.title}`
                : lease.taskId;
              return (
                <li
                  key={lease.id}
                  className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm"
                >
                  <span className="font-medium text-foreground">
                    {lease.actor
                      ? `${lease.actor.provider}/${lease.actor.model}`
                      : t("agentLayer:common.agent")}
                  </span>
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                    params={{ workspaceId, projectId, taskId: lease.taskId }}
                    className="min-w-0 truncate text-foreground/80 underline-offset-2 hover:underline"
                  >
                    {taskLabel}
                  </Link>
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(lease.expiresAt)}
                  >
                    {t("agentLayer:overview.leaseExpires", {
                      time: formatRelativeTime(lease.expiresAt),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Counter({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/80 bg-background px-3 py-2">
      {icon}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-lg font-semibold leading-tight text-foreground tabular-nums">
          {value}
        </p>
      </div>
    </div>
  );
}
