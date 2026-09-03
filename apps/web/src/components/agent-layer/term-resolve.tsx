import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentTermResolve } from "@/hooks/queries/agent-layer/use-agent-term-resolve";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import { TermRow } from "./term-row";

type TermResolveProps = {
  workspaceId: string;
};

/**
 * "What does this word mean here?" — exact lookup against canonical names and
 * aliases. The answer is deterministic, so it is only fetched on submit.
 */
export function TermResolve({ workspaceId }: TermResolveProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const query = useAgentTermResolve(workspaceId, submitted);
  const result = query.data;

  return (
    <div className="space-y-2" data-testid="term-resolve">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(input.trim());
        }}
      >
        <Input
          value={input}
          placeholder={t("agentLayer:knowledge.resolvePlaceholder")}
          aria-label={t("agentLayer:knowledge.resolveLabel")}
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
          data-testid="resolve-input"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={input.trim().length === 0}
          data-testid="resolve-submit"
        >
          <Search />
          {t("agentLayer:knowledge.resolveButton")}
        </Button>
      </form>

      {submitted.length === 0 ? null : query.isPending ? (
        <AgentLayerSkeleton rows={1} />
      ) : query.isError ? (
        <AgentLayerErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : result ? (
        <div
          className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3"
          data-testid="resolve-result"
          data-match={result.match}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{submitted}</span>
            <Badge
              variant={
                result.match === "none"
                  ? "outline"
                  : result.ambiguous.length > 0
                    ? "warning"
                    : "info"
              }
              size="sm"
              data-testid="resolve-match"
            >
              {result.ambiguous.length > 0
                ? t("agentLayer:knowledge.resolveAmbiguous", {
                    count: result.ambiguous.length,
                  })
                : t(`agentLayer:knowledge.resolveMatch.${result.match}`)}
            </Badge>
          </div>
          {result.ambiguous.length > 0 ? (
            <ul className="divide-y divide-border/70 rounded-md border border-border/80 bg-background">
              {result.ambiguous.map((term) => (
                <TermRow key={term.id} term={term} />
              ))}
            </ul>
          ) : result.term ? (
            <ul className="rounded-md border border-border/80 bg-background">
              <TermRow term={result.term} />
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("agentLayer:knowledge.resolveNoneHint")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
