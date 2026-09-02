import { Cpu, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { AgentEntryKind } from "@/fetchers/agent-layer/get-agent-entries";
import { cn } from "@/lib/cn";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatTokens(value: number) {
  return compactNumber.format(value);
}

/** The model that spent the most tokens on a node, or null when nothing ran. */
export function topModel(byModel: Record<string, number>) {
  let best: { model: string; tokens: number } | null = null;
  for (const [model, tokens] of Object.entries(byModel)) {
    if (!best || tokens > best.tokens) best = { model, tokens };
  }
  return best;
}

const KIND_VARIANTS: Record<
  AgentEntryKind,
  "info" | "warning" | "success" | "secondary"
> = {
  work: "secondary",
  investigation: "info",
  decision: "warning",
  handoff: "success",
};

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useTranslation();
  const known = kind as AgentEntryKind;
  const variant = KIND_VARIANTS[known] ?? "outline";
  return (
    <Badge variant={variant} size="sm" data-testid="kind-badge">
      {KIND_VARIANTS[known] ? t(`agentLayer:kind.${known}`) : kind}
    </Badge>
  );
}

export function BranchChip({
  repo,
  branch,
  className,
}: {
  repo?: string | null;
  branch: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn("max-w-full font-mono", className)}
      title={repo ? `${repo}:${branch}` : branch}
      data-testid="branch-chip"
    >
      <GitBranch />
      <span className="truncate">{repo ? `${repo}:${branch}` : branch}</span>
    </Badge>
  );
}

export function UsageChip({
  model,
  totalTokens,
  className,
}: {
  model: string | null | undefined;
  totalTokens: number;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn("max-w-full", className)}
      title={t("agentLayer:common.tokens", { value: totalTokens })}
      data-testid="usage-chip"
    >
      <Cpu />
      <span className="truncate">
        {model ?? t("agentLayer:common.unknownModel")} ·{" "}
        {formatTokens(totalTokens)}
      </span>
    </Badge>
  );
}

/** "provider/model · label · effort" — the actor line shared by callout and rows. */
export function actorLine(input: {
  actor: { provider: string; model: string } | null;
  agentLabel?: string | null;
  effort?: string | null;
}) {
  return [
    input.actor ? `${input.actor.provider}/${input.actor.model}` : null,
    input.agentLabel ?? null,
    input.effort ?? null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
