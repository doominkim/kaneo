import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { useProposeAgentTerm } from "@/hooks/mutations/agent-layer/use-propose-agent-term";
import { useAgentDomains } from "@/hooks/queries/agent-layer/use-agent-domains";
import { toast } from "@/lib/toast";
import { DomainSelect } from "./domain-select";

type ProposeTermDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
};

/** "a, b, c" → ["a", "b", "c"]; blanks and duplicates dropped. */
export function splitList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Human-side entry into the lexicon. Lands as `proposed` like every other
 * proposal; confirmation is a separate, reviewed step (DESIGN.md §4.4).
 */
export function ProposeTermDialog({
  open,
  onOpenChange,
  workspaceId,
}: ProposeTermDialogProps) {
  const { t } = useTranslation();
  const [canonical, setCanonical] = useState("");
  const [definition, setDefinition] = useState("");
  const [aliases, setAliases] = useState("");
  const [notToConfuseWith, setNotToConfuseWith] = useState("");
  const [domainId, setDomainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useProposeAgentTerm();
  const domains = useAgentDomains(open ? workspaceId : "");

  const reset = () => {
    setCanonical("");
    setDefinition("");
    setAliases("");
    setNotToConfuseWith("");
    setDomainId(null);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = canonical.trim();
    if (!trimmed) {
      setError(t("agentLayer:knowledge.canonicalRequired"));
      return;
    }
    try {
      await mutateAsync({
        workspaceId,
        canonical: trimmed,
        definition: definition.trim() || null,
        aliases: splitList(aliases),
        notToConfuseWith: splitList(notToConfuseWith),
        anchors: [],
        domainId,
      });
      toast.success(t("agentLayer:knowledge.proposed", { term: trimmed }));
      reset();
      onOpenChange(false);
    } catch (cause) {
      if (isAgentLayerStatus(cause, 409)) {
        setError(t("agentLayer:knowledge.proposeConflict"));
        return;
      }
      if (isAgentLayerStatus(cause, 400)) {
        setError(cause instanceof Error ? cause.message : null);
        return;
      }
      toast.error(t("agentLayer:knowledge.proposeFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="propose-dialog">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>{t("agentLayer:knowledge.proposeTitle")}</DialogTitle>
            <DialogDescription>
              {t("agentLayer:knowledge.proposeDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-term-canonical">
                {t("agentLayer:knowledge.canonicalLabel")}
              </Label>
              <Input
                id="agent-term-canonical"
                value={canonical}
                autoFocus
                autoComplete="off"
                onChange={(event) => {
                  setCanonical(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-term-definition">
                {t("agentLayer:knowledge.definitionLabel")}
              </Label>
              <Textarea
                id="agent-term-definition"
                value={definition}
                rows={3}
                onChange={(event) => setDefinition(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-term-aliases">
                {t("agentLayer:knowledge.aliasesLabel")}
              </Label>
              <Input
                id="agent-term-aliases"
                value={aliases}
                autoComplete="off"
                onChange={(event) => setAliases(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:knowledge.aliasesHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-term-not-to-confuse">
                {t("agentLayer:knowledge.notToConfuseLabel")}
              </Label>
              <Input
                id="agent-term-not-to-confuse"
                value={notToConfuseWith}
                autoComplete="off"
                onChange={(event) => setNotToConfuseWith(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:knowledge.notToConfuseHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-term-domain">
                {t("agentLayer:knowledge.domainLabel")}
              </Label>
              <DomainSelect
                id="agent-term-domain"
                nodes={domains.data?.domains}
                value={domainId}
                onChange={setDomainId}
                data-testid="propose-domain-select"
              />
            </div>
            {error ? (
              <p className="text-xs text-destructive-foreground" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              {t("agentLayer:knowledge.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              data-testid="propose-submit"
            >
              {isPending
                ? t("agentLayer:knowledge.proposing")
                : t("agentLayer:knowledge.proposeSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
