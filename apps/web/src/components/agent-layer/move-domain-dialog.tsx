import { useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import { useMoveAgentDomain } from "@/hooks/mutations/agent-layer/use-move-agent-domain";
import { toast } from "@/lib/toast";
import { DomainSelect } from "./domain-select";
import { descendantIds } from "./domain-tree";

type MoveDomainDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  domain: { id: string; title: string; parentId: string | null };
  nodes: AgentDomainNode[] | undefined;
};

/**
 * Re-parent a page. The page and its descendants are not offered as targets
 * (the API would answer 400 for the cycle anyway); a slug clash at the new
 * level is the API's 409 and is shown as it came.
 */
export function MoveDomainDialog({
  open,
  onOpenChange,
  workspaceId,
  domain,
  nodes,
}: MoveDomainDialogProps) {
  const { t } = useTranslation();
  const [parentId, setParentId] = useState<string | null>(domain.parentId);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useMoveAgentDomain();
  const excluded = useMemo(
    () => descendantIds(nodes, domain.id),
    [nodes, domain.id],
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setParentId(domain.parentId);
      setError(null);
    }
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await mutateAsync({
        workspaceId,
        domainId: domain.id,
        body: { parentId },
      });
      toast.success(t("agentLayer:domain.moved", { title: domain.title }));
      onOpenChange(false);
    } catch (cause) {
      if (isAgentLayerStatus(cause, 400) || isAgentLayerStatus(cause, 409)) {
        setError(cause instanceof Error ? cause.message : null);
        return;
      }
      toast.error(t("agentLayer:domain.moveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="move-domain-dialog">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {t("agentLayer:domain.moveTitle", { title: domain.title })}
            </DialogTitle>
            <DialogDescription>
              {t("agentLayer:domain.moveDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-domain-parent">
                {t("agentLayer:domain.moveParentLabel")}
              </Label>
              <DomainSelect
                id="agent-domain-parent"
                nodes={nodes}
                value={parentId}
                excludeIds={excluded}
                noneLabel={t("agentLayer:domain.rootLabel")}
                onChange={(next) => {
                  setParentId(next);
                  setError(null);
                }}
                data-testid="move-parent-select"
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
              {t("agentLayer:domain.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isPending || parentId === domain.parentId}
              data-testid="move-domain-submit"
            >
              {isPending
                ? t("agentLayer:domain.moving")
                : t("agentLayer:domain.move")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
