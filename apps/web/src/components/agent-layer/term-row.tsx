import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import type {
  AgentTerm,
  AgentTermConfidence,
  AgentTermState,
} from "@/fetchers/agent-layer/get-agent-terms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { DomainChip } from "./domain-chip";
import { DomainSelect } from "./domain-select";

export type TermAnchor = {
  kind: string;
  table?: string;
  column?: string;
  repo?: string;
  path?: string;
  symbol?: string;
  url?: string;
};

// `anchors` is `unknown` on the wire; older rows may carry any shape.
export function parseAnchors(value: unknown): TermAnchor[] {
  if (!Array.isArray(value)) return [];
  const out: TermAnchor[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.kind !== "string") continue;
    const pick = (key: string) =>
      typeof record[key] === "string" ? (record[key] as string) : undefined;
    out.push({
      kind: record.kind,
      table: pick("table"),
      column: pick("column"),
      repo: pick("repo"),
      path: pick("path"),
      symbol: pick("symbol"),
      url: pick("url"),
    });
  }
  return out;
}

/** "benefits.benefit_cd", "repo:path#symbol", or the url — whatever the anchor names. */
export function anchorLabel(anchor: TermAnchor) {
  if (anchor.kind === "db") {
    return [anchor.table, anchor.column].filter(Boolean).join(".");
  }
  if (anchor.kind === "doc" && anchor.url) return anchor.url;
  const location = [anchor.repo, anchor.path].filter(Boolean).join(":");
  return anchor.symbol ? `${location}#${anchor.symbol}` : location;
}

const CONFIDENCE_VARIANTS: Record<
  AgentTermConfidence,
  "success" | "warning" | "error"
> = {
  confirmed: "success",
  proposed: "warning",
  disputed: "error",
};

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const { t } = useTranslation();
  const known = confidence as AgentTermConfidence;
  return (
    <Badge
      variant={CONFIDENCE_VARIANTS[known] ?? "outline"}
      size="sm"
      data-testid="confidence-badge"
    >
      {CONFIDENCE_VARIANTS[known]
        ? t(`agentLayer:confidence.${known}`)
        : confidence}
    </Badge>
  );
}

const STATES: AgentTermState[] = ["active", "dormant", "stale", "retired"];

export function StateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  const known = STATES.includes(state as AgentTermState);
  return (
    <Badge
      variant={state === "retired" ? "secondary" : "outline"}
      size="sm"
      data-testid="state-badge"
    >
      {known ? t(`agentLayer:state.${state as AgentTermState}`) : state}
    </Badge>
  );
}

type TermRowProps = {
  term: AgentTerm;
  canReview?: boolean;
  onReview?: (term: AgentTerm, confidence: "confirmed" | "disputed") => void;
  /**
   * workspace:update. Every row is offered for deletion regardless of
   * confidence or state; the API refuses only a term another term supersedes
   * to, and that reason is surfaced from the 409.
   */
  canDelete?: boolean;
  onDelete?: (term: AgentTerm) => void;
  /** With `domainNodes`, the row shows the page the term is filed under. */
  workspaceId?: string;
  domainNodes?: AgentDomainNode[];
  /** workspace:update — the same gate as review (KAN-14). */
  canSetDomain?: boolean;
  onSetDomain?: (term: AgentTerm, domainId: string | null) => void;
};

/** One lexicon entry (DESIGN.md §4.4); shared by the list and the resolver. */
export function TermRow({
  term,
  canReview = false,
  onReview,
  canDelete = false,
  onDelete,
  workspaceId,
  domainNodes,
  canSetDomain = false,
  onSetDomain,
}: TermRowProps) {
  const { t } = useTranslation();
  const [showDefinition, setShowDefinition] = useState(false);
  const anchors = parseAnchors(term.anchors);
  const domain = term.domainId
    ? domainNodes?.find((node) => node.id === term.domainId)
    : undefined;

  return (
    <li
      data-testid="term-row"
      data-confidence={term.confidence}
      data-state={term.state}
      className="space-y-2 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-foreground">
          {term.canonical}
        </span>
        <ConfidenceBadge confidence={term.confidence} />
        {term.state !== "active" ? <StateBadge state={term.state} /> : null}
        {term.aliases.map((alias) => (
          <Badge
            key={alias}
            variant="outline"
            size="sm"
            data-testid="alias-chip"
          >
            {alias}
          </Badge>
        ))}
        {domain && workspaceId ? (
          <DomainChip workspaceId={workspaceId} domain={domain} />
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {canReview ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={term.confidence === "confirmed"}
                onClick={() => onReview?.(term, "confirmed")}
                data-testid="confirm-term"
              >
                {t("agentLayer:knowledge.confirm")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={term.confidence === "disputed"}
                onClick={() => onReview?.(term, "disputed")}
                data-testid="dispute-term"
              >
                {t("agentLayer:knowledge.dispute")}
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onDelete?.(term)}
              aria-label={t("agentLayer:knowledge.delete")}
              title={t("agentLayer:knowledge.delete")}
              data-testid="delete-term"
            >
              <Trash2 />
            </Button>
          ) : null}
        </span>
      </div>

      {term.notToConfuseWith.length > 0 ? (
        <p
          className="text-xs text-warning-foreground"
          data-testid="not-to-confuse"
        >
          {t("agentLayer:knowledge.notToConfuse")}{" "}
          <span className="font-medium">
            {term.notToConfuseWith.join(", ")}
          </span>
        </p>
      ) : null}

      {anchors.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="anchors">
          {anchors.map((anchor) => {
            const label = anchorLabel(anchor);
            return (
              <Badge
                key={`${anchor.kind}:${label}`}
                variant="secondary"
                size="sm"
                className="max-w-full font-mono"
                title={`${anchor.kind} ${label}`}
                data-testid="anchor-chip"
              >
                <span className="text-muted-foreground">{anchor.kind}</span>
                <span className="truncate">{label}</span>
              </Badge>
            );
          })}
        </div>
      ) : null}

      {term.state === "retired" && term.supersededBy ? (
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:knowledge.supersededBy", { id: term.supersededBy })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {term.definition ? (
          <button
            type="button"
            aria-expanded={showDefinition}
            onClick={() => setShowDefinition((current) => !current)}
            className="flex items-center gap-1 transition-colors hover:text-foreground"
            data-testid="definition-toggle"
          >
            {showDefinition ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {showDefinition
              ? t("agentLayer:knowledge.hideDefinition")
              : t("agentLayer:knowledge.showDefinition")}
          </button>
        ) : (
          <span>{t("agentLayer:knowledge.noDefinition")}</span>
        )}
        {term.lastVerifiedAt ? (
          <span title={formatDateTime(term.lastVerifiedAt)}>
            {t("agentLayer:knowledge.lastVerified", {
              time: formatRelativeTime(term.lastVerifiedAt),
            })}
          </span>
        ) : null}
        {canSetDomain && workspaceId ? (
          <span className="ml-auto inline-flex items-center gap-1">
            <span>{t("agentLayer:knowledge.assignDomain")}</span>
            <DomainSelect
              nodes={domainNodes}
              value={term.domainId}
              onChange={(next) => onSetDomain?.(term, next)}
              size="sm"
              className="h-6 min-h-6 w-auto min-w-28 max-w-56 text-xs sm:min-h-6"
              data-testid="term-domain-select"
            />
          </span>
        ) : null}
      </div>

      {showDefinition && term.definition ? (
        <div
          className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm"
          data-testid="definition"
        >
          <MarkdownRenderer content={term.definition} />
        </div>
      ) : null}
    </li>
  );
}
