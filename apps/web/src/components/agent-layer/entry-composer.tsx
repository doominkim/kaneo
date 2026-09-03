import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import type { HumanAgentEntryBody } from "@/fetchers/agent-layer/append-agent-entry";
import type { AgentEntryKind } from "@/fetchers/agent-layer/get-agent-entries";
import { useAppendAgentEntry } from "@/hooks/mutations/agent-layer/use-append-agent-entry";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

export const SUMMARY_MAX = 200;

const KINDS: AgentEntryKind[] = [
  "work",
  "investigation",
  "decision",
  "handoff",
];

type EntryComposerProps = {
  projectId: string;
  /** Omit for a project-level note (no task). */
  taskId?: string | null;
  /** The task's latest branch, offered as the default `refs` value. */
  defaultBranch?: { repo?: string | null; branch: string } | null;
  /** Called after a successful append and on cancel. */
  onClose: () => void;
  className?: string;
};

type ComposerInput = {
  kind: AgentEntryKind;
  summary: string;
  body: string;
  what: string;
  why: string;
  rejected: string;
  reversible: boolean;
  repo: string;
  branch: string;
};

type Validation = {
  summary?: "required" | "tooLong";
  decision?: "required";
};

export function validateComposer(input: ComposerInput): Validation {
  const errors: Validation = {};
  const summary = input.summary.trim();
  if (!summary) errors.summary = "required";
  else if (summary.length > SUMMARY_MAX) errors.summary = "tooLong";
  if (input.kind === "decision" && (!input.what.trim() || !input.why.trim())) {
    errors.decision = "required";
  }
  return errors;
}

/**
 * The wire shape of a HUMAN entry. `provider`/`model` are never present —
 * not even as null — because their presence is what the API reads as "an
 * agent wrote this". Empty optionals are omitted rather than sent as "".
 */
export function toHumanEntryBody(
  projectId: string,
  taskId: string | null | undefined,
  input: ComposerInput,
): HumanAgentEntryBody {
  const repo = input.repo.trim();
  const branch = input.branch.trim();
  const rejected = input.rejected.trim();
  const body = input.body.trim();
  return {
    projectId,
    ...(taskId ? { taskId } : {}),
    kind: input.kind,
    summary: input.summary.trim(),
    ...(body ? { body: input.body } : {}),
    ...(input.kind === "decision"
      ? {
          decision: {
            what: input.what.trim(),
            why: input.why.trim(),
            ...(rejected ? { rejected } : {}),
            reversible: input.reversible,
          },
        }
      : {}),
    ...(repo || branch
      ? { refs: { ...(repo ? { repo } : {}), ...(branch ? { branch } : {}) } }
      : {}),
  };
}

/**
 * Inline note composer for the ledger. A person writes into the same stream
 * agents do (DESIGN.md §2.3): the API attributes the row to the current user
 * because the body carries no provider/model, so this form never asks who is
 * writing. Kind decides what else is asked — a decision must say what and why,
 * since "what was rejected" is the part no diff preserves.
 */
export function EntryComposer({
  projectId,
  taskId,
  defaultBranch,
  onClose,
  className,
}: EntryComposerProps) {
  const { t } = useTranslation();
  const id = useId();
  const [kind, setKind] = useState<AgentEntryKind>("work");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const [rejected, setRejected] = useState("");
  const [reversible, setReversible] = useState(true);
  const [repo, setRepo] = useState(defaultBranch?.repo ?? "");
  const [branch, setBranch] = useState(defaultBranch?.branch ?? "");
  const [errors, setErrors] = useState<Validation>({});
  const { mutateAsync, isPending } = useAppendAgentEntry();

  const input: ComposerInput = {
    kind,
    summary,
    body,
    what,
    why,
    rejected,
    reversible,
    repo,
    branch,
  };
  const summaryLength = summary.trim().length;

  const submit = async () => {
    const validation = validateComposer(input);
    setErrors(validation);
    if (validation.summary || validation.decision) return;

    try {
      await mutateAsync(toHumanEntryBody(projectId, taskId, input));
      toast.success(t("agentLayer:composer.saved"));
      onClose();
    } catch (cause) {
      const message = isAgentLayerStatus(cause, 403)
        ? t("agentLayer:composer.forbidden")
        : cause instanceof Error
          ? cause.message
          : undefined;
      toast.error(t("agentLayer:composer.failed"), { description: message });
    }
  };

  return (
    <form
      data-testid="entry-composer"
      data-scope={taskId ? "task" : "project"}
      className={cn(
        "space-y-3 rounded-lg border border-border/80 bg-background p-3",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="float-left text-xs font-medium text-muted-foreground">
          {t("agentLayer:composer.kind")}
        </legend>
        <div
          data-testid="composer-kind"
          className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5"
        >
          {KINDS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={kind === option ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={kind === option}
              data-kind={option}
              onClick={() => setKind(option)}
              className={cn(
                "h-6 rounded-md px-2 text-xs",
                kind !== option && "text-muted-foreground",
              )}
            >
              {t(`agentLayer:kind.${option}`)}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-summary`}>
            {t("agentLayer:composer.summary")}
          </Label>
          <span
            data-testid="composer-summary-counter"
            className={cn(
              "text-xs tabular-nums text-muted-foreground",
              summaryLength > SUMMARY_MAX && "text-destructive-foreground",
            )}
          >
            {t("agentLayer:composer.summaryCounter", {
              used: summaryLength,
              max: SUMMARY_MAX,
            })}
          </span>
        </div>
        <Input
          id={`${id}-summary`}
          data-testid="composer-summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder={t("agentLayer:composer.summaryPlaceholder")}
          aria-invalid={Boolean(errors.summary)}
          autoFocus
        />
        {errors.summary ? (
          <p className="text-xs text-destructive-foreground" role="alert">
            {errors.summary === "required"
              ? t("agentLayer:composer.summaryRequired")
              : t("agentLayer:composer.summaryTooLong", { max: SUMMARY_MAX })}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-body`}>{t("agentLayer:composer.body")}</Label>
        {/* No taskId is passed on purpose: attachments belong to a task's
            comment thread, not to the ledger (see document-page). */}
        <div id={`${id}-body`} data-testid="composer-body">
          <CommentEditor
            value={body}
            onChange={setBody}
            placeholder={t("agentLayer:composer.bodyPlaceholder")}
            showQuickAttachButton={false}
            className="min-h-[7rem] rounded-lg border border-border/80"
            onSubmitShortcut={() => void submit()}
            onCancelShortcut={onClose}
          />
        </div>
      </div>

      {kind === "decision" ? (
        <fieldset
          data-testid="composer-decision"
          className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2.5"
        >
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            {t("agentLayer:timeline.decision")}
          </legend>
          <div className="space-y-1">
            <Label htmlFor={`${id}-what`} className="text-xs">
              {t("agentLayer:timeline.decisionWhat")}
            </Label>
            <Input
              id={`${id}-what`}
              data-testid="composer-what"
              size="sm"
              value={what}
              onChange={(event) => setWhat(event.target.value)}
              aria-invalid={Boolean(errors.decision) && !what.trim()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-why`} className="text-xs">
              {t("agentLayer:timeline.decisionWhy")}
            </Label>
            <Textarea
              id={`${id}-why`}
              data-testid="composer-why"
              rows={2}
              value={why}
              onChange={(event) => setWhy(event.target.value)}
              aria-invalid={Boolean(errors.decision) && !why.trim()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-rejected`} className="text-xs">
              {t("agentLayer:timeline.decisionRejected")}
            </Label>
            <Textarea
              id={`${id}-rejected`}
              data-testid="composer-rejected"
              rows={2}
              value={rejected}
              onChange={(event) => setRejected(event.target.value)}
              placeholder={t("agentLayer:composer.rejectedPlaceholder")}
            />
          </div>
          <Label className="text-xs font-normal">
            <Checkbox
              data-testid="composer-reversible"
              checked={reversible}
              onCheckedChange={(checked) => setReversible(checked === true)}
            />
            {t("agentLayer:timeline.reversible")}
          </Label>
          {errors.decision ? (
            <p className="text-xs text-destructive-foreground" role="alert">
              {t("agentLayer:composer.decisionRequired")}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-repo`} className="text-xs">
            {t("agentLayer:timeline.refsRepo")}
          </Label>
          <Input
            id={`${id}-repo`}
            data-testid="composer-repo"
            size="sm"
            className="font-mono"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="owner/repo"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-branch`} className="text-xs">
            {t("agentLayer:timeline.refsBranch")}
          </Label>
          <Input
            id={`${id}-branch`}
            data-testid="composer-branch"
            size="sm"
            className="font-mono"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="feat/..."
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="composer-cancel"
          disabled={isPending}
          onClick={onClose}
        >
          {t("agentLayer:composer.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          data-testid="composer-submit"
          disabled={isPending}
        >
          {isPending
            ? t("agentLayer:composer.submitting")
            : t("agentLayer:composer.submit")}
        </Button>
      </div>
    </form>
  );
}
