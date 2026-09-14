import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { AgentDecisionDetail } from "@/fetchers/agent-layer/agent-decisions";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { useCreateAgentDecision } from "@/hooks/mutations/agent-layer/use-agent-decisions";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /**
   * An accepted ADR the new one replaces. Its fields prefill the form, and
   * creating the new ADR marks it superseded in the same transaction.
   */
  supersedes?: AgentDecisionDetail;
  preselectedTaskId?: string;
  onSaved: (decision: AgentDecisionDetail) => void;
};

/**
 * "새 ADR" and "이 결정을 대체" (agent-autoapply). An ADR is accepted the
 * moment it exists and is never edited, so this dialog only ever creates.
 */
export function AdrEditorDialog({
  open,
  onOpenChange,
  projectId,
  supersedes,
  preselectedTaskId,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [what, setWhat] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [consequences, setConsequences] = useState("");
  const [reversible, setReversible] = useState<boolean | null>(null);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tasks = useGetTasks(open ? projectId : "");
  const create = useCreateAgentDecision();
  const projectTasks = tasks.data
    ? [
        ...tasks.data.columns.flatMap((column) => column.tasks),
        ...tasks.data.archivedTasks,
        ...tasks.data.plannedTasks,
      ]
    : [];
  const number = supersedes ? String(supersedes.number).padStart(3, "0") : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a background refetch must not replace a dirty dialog snapshot.
  useEffect(() => {
    if (!open) return;
    setTitle(supersedes?.title ?? "");
    setContext(supersedes?.context ?? "");
    setWhat(supersedes?.decision ?? "");
    setAlternatives(supersedes?.alternatives ?? "");
    setConsequences(supersedes?.consequences ?? "");
    setReversible(supersedes?.reversible ?? null);
    setTaskIds(
      supersedes?.tasks.map((task) => task.id) ??
        (preselectedTaskId ? [preselectedTaskId] : []),
    );
    setError(null);
  }, [open, supersedes?.id, preselectedTaskId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !context.trim() || !what.trim()) {
      setError(t("agentLayer:adr.required"));
      return;
    }
    try {
      const data = await create.mutateAsync({
        projectId,
        title: title.trim(),
        context: context.trim(),
        decision: what.trim(),
        alternatives: alternatives.trim() || null,
        consequences: consequences.trim() || null,
        reversible,
        refs: supersedes?.refs ?? null,
        taskIds,
        ...(supersedes ? { supersedesDecisionId: supersedes.id } : {}),
      });
      onSaved(data);
      onOpenChange(false);
    } catch (cause) {
      setError(
        supersedes && isAgentLayerStatus(cause, 409)
          ? t("agentLayer:adr.supersedeConflict", { number })
          : cause instanceof Error
            ? cause.message
            : t("agentLayer:adr.saveFailed"),
      );
    }
  };
  const pending = create.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="adr-editor">
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {supersedes
                ? t("agentLayer:adr.supersedeTitle", { number })
                : t("agentLayer:adr.newTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("agentLayer:adr.immutableHint")}
            </DialogDescription>
          </DialogHeader>
          <fieldset
            className="max-h-[60vh] space-y-4 overflow-y-auto px-6 pb-2"
            disabled={pending}
          >
            {supersedes ? (
              <p
                className="rounded border bg-muted/30 p-2 text-sm"
                data-testid="adr-supersede-hint"
              >
                {t("agentLayer:adr.supersedeHint", { number })}
              </p>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="adr-title">{t("agentLayer:adr.title")}</Label>
              <Input
                id="adr-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adr-context">{t("agentLayer:adr.context")}</Label>
              <Textarea
                id="adr-context"
                value={context}
                onChange={(event) => setContext(event.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adr-decision">
                {t("agentLayer:adr.decision")}
              </Label>
              <Textarea
                id="adr-decision"
                value={what}
                onChange={(event) => setWhat(event.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adr-alternatives">
                {t("agentLayer:adr.alternatives")}
              </Label>
              <Textarea
                id="adr-alternatives"
                value={alternatives}
                onChange={(event) => setAlternatives(event.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adr-consequences">
                {t("agentLayer:adr.consequences")}
              </Label>
              <Textarea
                id="adr-consequences"
                value={consequences}
                onChange={(event) => setConsequences(event.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={reversible === true}
                onCheckedChange={(checked) => setReversible(Boolean(checked))}
                aria-label={t("agentLayer:adr.reversible")}
              />
              {t("agentLayer:adr.reversible")}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("agentLayer:adr.relatedTasks")}
              </legend>
              {projectTasks.map((task) => (
                <div className="flex items-center gap-2 text-sm" key={task.id}>
                  <Checkbox
                    checked={taskIds.includes(task.id)}
                    aria-label={task.title}
                    onCheckedChange={(checked) =>
                      setTaskIds((current) =>
                        checked
                          ? [...new Set([...current, task.id])]
                          : current.filter((id) => id !== task.id),
                      )
                    }
                  />
                  {task.number != null ? `#${task.number} ` : ""}
                  {task.title}
                </div>
              ))}
            </fieldset>
            {supersedes?.sourceNote ? (
              <div className="space-y-1">
                <Label>{t("agentLayer:adr.sourceNote")}</Label>
                <p className="rounded border bg-muted/30 p-2 text-sm whitespace-pre-wrap">
                  {supersedes.sourceNote}
                </p>
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("agentLayer:adr.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? t("agentLayer:adr.saving")
                : t("agentLayer:adr.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
