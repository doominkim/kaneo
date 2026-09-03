import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import type {
  AgentTerm,
  AgentTermConfidence,
  AgentTermState,
} from "@/fetchers/agent-layer/get-agent-terms";
import { useConfirmAgentTerm } from "@/hooks/mutations/agent-layer/use-confirm-agent-term";
import { useDeleteAgentTerm } from "@/hooks/mutations/agent-layer/use-delete-agent-term";
import { useSetAgentTermDomain } from "@/hooks/mutations/agent-layer/use-set-agent-term-domain";
import { useAgentDomains } from "@/hooks/queries/agent-layer/use-agent-domains";
import { useAgentTerms } from "@/hooks/queries/agent-layer/use-agent-terms";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "./agent-layer-state";
import { TermRow } from "./term-row";

const CONFIDENCES: AgentTermConfidence[] = [
  "proposed",
  "confirmed",
  "disputed",
];
const STATES: AgentTermState[] = ["active", "dormant", "stale", "retired"];

type PendingReview = {
  term: AgentTerm;
  confidence: "confirmed" | "disputed";
};

type TermListProps = {
  workspaceId: string;
  /** workspace:update — the only path from proposed to confirmed. */
  canReview: boolean;
};

/** Glossary section of the knowledge tab: filters, rows, human review. */
export function TermList({ workspaceId, canReview }: TermListProps) {
  const { t } = useTranslation();
  const [confidence, setConfidence] = useState<AgentTermConfidence | undefined>(
    undefined,
  );
  const [state, setState] = useState<AgentTermState | undefined>(undefined);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AgentTerm | null>(null);
  const query = useAgentTerms(workspaceId, confidence, state);
  const review = useConfirmAgentTerm();
  const remove = useDeleteAgentTerm();
  const domains = useAgentDomains(workspaceId);
  const setDomain = useSetAgentTermDomain();

  const handleSetDomain = async (term: AgentTerm, domainId: string | null) => {
    try {
      await setDomain.mutateAsync({ workspaceId, termId: term.id, domainId });
      toast.success(
        t("agentLayer:knowledge.domainSet", { term: term.canonical }),
      );
    } catch (cause) {
      toast.error(t("agentLayer:knowledge.domainSetFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const handleReview = async () => {
    if (!pending) return;
    try {
      await review.mutateAsync({
        workspaceId,
        termId: pending.term.id,
        confidence: pending.confidence,
      });
      toast.success(
        t("agentLayer:knowledge.reviewed", {
          term: pending.term.canonical,
          confidence: t(`agentLayer:confidence.${pending.confidence}`),
        }),
      );
      setPending(null);
    } catch (cause) {
      toast.error(t("agentLayer:knowledge.reviewFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  // 409 carries the API's own reason (reviewed term, or another term's
  // `supersededBy` points here); it is shown verbatim rather than mapped.
  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync({ workspaceId, termId: pendingDelete.id });
      toast.success(
        t("agentLayer:knowledge.deleted", { term: pendingDelete.canonical }),
      );
      setPendingDelete(null);
    } catch (cause) {
      if (isAgentLayerStatus(cause, 409)) {
        toast.error(t("agentLayer:knowledge.deleteRefused"), {
          description: cause instanceof Error ? cause.message : undefined,
        });
        return;
      }
      toast.error(t("agentLayer:knowledge.deleteFailed"), {
        description: isAgentLayerStatus(cause, 403)
          ? t("agentLayer:knowledge.deleteForbidden")
          : cause instanceof Error
            ? cause.message
            : undefined,
      });
    }
  };

  const terms = query.data?.terms ?? [];

  return (
    <div className="space-y-3" data-testid="term-list">
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          label={t("agentLayer:knowledge.filterConfidence")}
          value={confidence}
          options={CONFIDENCES}
          labelOf={(option) => t(`agentLayer:confidence.${option}`)}
          onChange={setConfidence}
          testId="confidence-filter"
        />
        <FilterGroup
          label={t("agentLayer:knowledge.filterState")}
          value={state}
          options={STATES}
          labelOf={(option) => t(`agentLayer:state.${option}`)}
          onChange={setState}
          testId="state-filter"
        />
      </div>

      {query.isPending ? (
        <AgentLayerSkeleton rows={4} />
      ) : query.isError ? (
        <AgentLayerErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : terms.length === 0 ? (
        <AgentLayerEmpty
          title={t("agentLayer:knowledge.termsEmpty")}
          description={t("agentLayer:knowledge.termsEmptyHint")}
        />
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/80 bg-background">
          {terms.map((term) => (
            <TermRow
              key={term.id}
              term={term}
              canReview={canReview}
              onReview={(reviewed, next) =>
                setPending({ term: reviewed, confidence: next })
              }
              canDelete={canReview}
              onDelete={setPendingDelete}
              workspaceId={workspaceId}
              domainNodes={domains.data?.domains}
              canSetDomain={canReview}
              onSetDomain={handleSetDomain}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && !review.isPending && setPending(null)}
      >
        <AlertDialogContent data-testid="review-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.confidence === "disputed"
                ? t("agentLayer:knowledge.disputeTitle", {
                    term: pending?.term.canonical,
                  })
                : t("agentLayer:knowledge.confirmTitle", {
                    term: pending?.term.canonical,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.confidence === "disputed"
                ? t("agentLayer:knowledge.disputeDescription")
                : t("agentLayer:knowledge.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={review.isPending}
                />
              }
            >
              {t("agentLayer:knowledge.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              variant={
                pending?.confidence === "disputed" ? "destructive" : "default"
              }
              disabled={review.isPending}
              onClick={handleReview}
              data-testid="review-submit"
            >
              {review.isPending
                ? t("agentLayer:knowledge.reviewing")
                : pending?.confidence === "disputed"
                  ? t("agentLayer:knowledge.dispute")
                  : t("agentLayer:knowledge.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) =>
          !open && !remove.isPending && setPendingDelete(null)
        }
      >
        <AlertDialogContent data-testid="delete-term-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentLayer:knowledge.deleteTitle", {
                term: pendingDelete?.canonical,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:knowledge.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                />
              }
            >
              {t("agentLayer:knowledge.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={handleDelete}
              data-testid="delete-term-submit"
            >
              {remove.isPending
                ? t("agentLayer:knowledge.deleting")
                : t("agentLayer:knowledge.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  labelOf,
  onChange,
  testId,
}: {
  label: string;
  value: T | undefined;
  options: T[];
  labelOf: (option: T) => string;
  onChange: (next: T | undefined) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5"
      data-testid={testId}
    >
      <legend className="sr-only">{label}</legend>
      <FilterButton
        active={value === undefined}
        onClick={() => onChange(undefined)}
      >
        {t("agentLayer:knowledge.filterAll")}
      </FilterButton>
      {options.map((option) => (
        <FilterButton
          key={option}
          active={value === option}
          onClick={() => onChange(option)}
        >
          {labelOf(option)}
        </FilterButton>
      ))}
    </fieldset>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-md px-2 text-xs",
        !active && "text-muted-foreground",
      )}
    >
      {children}
    </Button>
  );
}
