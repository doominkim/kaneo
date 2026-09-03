import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { AgentProjectSettings } from "@/fetchers/agent-layer/get-agent-project-settings";
import type { PutAgentProjectSettingsBody } from "@/fetchers/agent-layer/put-agent-project-settings";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  ARCHIVE_DAYS_RANGE,
  isInRange,
  MAX_CORE_PATH_LENGTH,
  MAX_CORE_PATHS,
  parseCorePaths,
  THRESHOLD_RANGE,
} from "./core-paths";

type ProjectSettingsFormProps = {
  settings: AgentProjectSettings;
  canEdit: boolean;
  isSaving: boolean;
  memberNameById: Map<string, string>;
  onSave: (body: PutAgentProjectSettingsBody) => Promise<void>;
};

/**
 * Agent Layer project settings (DESIGN.md §6.1 / §6.2). PUT is a full
 * replacement, so the form always submits all three fields. Members without
 * project:update get the same form disabled — a visible current state beats
 * a hidden one.
 */
export function ProjectSettingsForm({
  settings,
  canEdit,
  isSaving,
  memberNameById,
  onSave,
}: ProjectSettingsFormProps) {
  const { t } = useTranslation();
  const [corePathsText, setCorePathsText] = useState(
    settings.corePaths.join("\n"),
  );
  const [threshold, setThreshold] = useState(
    String(settings.activeTaskThreshold),
  );
  const [archiveDays, setArchiveDays] = useState(
    String(settings.doneArchiveDays),
  );
  const [submitted, setSubmitted] = useState(false);

  // A save (or a refetch) replaces the baseline; local edits are not merged.
  useEffect(() => {
    setCorePathsText(settings.corePaths.join("\n"));
    setThreshold(String(settings.activeTaskThreshold));
    setArchiveDays(String(settings.doneArchiveDays));
    setSubmitted(false);
  }, [settings]);

  const parsed = useMemo(() => parseCorePaths(corePathsText), [corePathsText]);
  const thresholdValue = Number(threshold);
  const archiveValue = Number(archiveDays);
  const thresholdValid = isInRange(thresholdValue, THRESHOLD_RANGE);
  const archiveValid = isInRange(archiveValue, ARCHIVE_DAYS_RANGE);

  const corePathErrors = [
    ...parsed.issues.map((issue) =>
      t(`agentLayer:settings.validation.${issue.reason}`, {
        line: issue.line,
        max: MAX_CORE_PATH_LENGTH,
      }),
    ),
    ...(parsed.tooMany
      ? [t("agentLayer:settings.validation.tooMany", { max: MAX_CORE_PATHS })]
      : []),
  ];
  const isValid = corePathErrors.length === 0 && thresholdValid && archiveValid;

  const isDirty =
    corePathsText !== settings.corePaths.join("\n") ||
    threshold !== String(settings.activeTaskThreshold) ||
    archiveDays !== String(settings.doneArchiveDays);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isValid || !canEdit) return;
    await onSave({
      corePaths: parsed.patterns,
      activeTaskThreshold: thresholdValue,
      doneArchiveDays: archiveValue,
    });
  };

  const updatedByLabel = settings.updatedBy
    ? (memberNameById.get(settings.updatedBy) ?? settings.updatedBy)
    : null;

  return (
    <form
      onSubmit={handleSubmit}
      // Native min/max validation would block submit with a browser tooltip;
      // the translated messages below are the one source of range feedback.
      noValidate
      className="space-y-4 rounded-md border border-border bg-sidebar p-4"
      data-testid="agent-layer-settings-form"
      aria-busy={isSaving}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge
          variant={settings.configured ? "success" : "outline"}
          size="sm"
          data-testid="settings-configured"
        >
          {settings.configured
            ? t("agentLayer:settings.configured")
            : t("agentLayer:settings.notConfigured")}
        </Badge>
        {settings.updatedAt ? (
          <span title={formatDateTime(settings.updatedAt)}>
            {t("agentLayer:settings.updatedBy", {
              name: updatedByLabel ?? t("agentLayer:common.agent"),
              time: formatRelativeTime(settings.updatedAt),
            })}
          </span>
        ) : null}
        {!canEdit ? (
          <span data-testid="settings-read-only">
            {t("agentLayer:settings.readOnly")}
          </span>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-1.5">
        <Label htmlFor="agent-core-paths">
          {t("agentLayer:settings.corePathsLabel")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:settings.corePathsHint", { max: MAX_CORE_PATHS })}
        </p>
        <Textarea
          id="agent-core-paths"
          value={corePathsText}
          disabled={!canEdit}
          spellCheck={false}
          placeholder={"src/domain/**\n**/migrations/**"}
          className="font-mono text-xs"
          rows={6}
          aria-invalid={corePathErrors.length > 0 || undefined}
          onChange={(event) => setCorePathsText(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:settings.corePathsCount", {
            count: parsed.patterns.length,
            max: MAX_CORE_PATHS,
          })}
        </p>
        {corePathErrors.map((message) => (
          <p
            key={message}
            className="text-xs text-destructive-foreground"
            role="alert"
          >
            {message}
          </p>
        ))}
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="agent-threshold">
            {t("agentLayer:settings.thresholdLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("agentLayer:settings.thresholdHint")}
          </p>
          <Input
            id="agent-threshold"
            type="number"
            inputMode="numeric"
            min={THRESHOLD_RANGE.min}
            max={THRESHOLD_RANGE.max}
            value={threshold}
            disabled={!canEdit}
            aria-invalid={(submitted && !thresholdValid) || undefined}
            onChange={(event) => setThreshold(event.target.value)}
          />
          {submitted && !thresholdValid ? (
            <p className="text-xs text-destructive-foreground" role="alert">
              {t("agentLayer:settings.validation.thresholdRange", {
                min: THRESHOLD_RANGE.min,
                max: THRESHOLD_RANGE.max,
              })}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-archive-days">
            {t("agentLayer:settings.archiveDaysLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("agentLayer:settings.archiveDaysHint")}
          </p>
          <Input
            id="agent-archive-days"
            type="number"
            inputMode="numeric"
            min={ARCHIVE_DAYS_RANGE.min}
            max={ARCHIVE_DAYS_RANGE.max}
            value={archiveDays}
            disabled={!canEdit}
            aria-invalid={(submitted && !archiveValid) || undefined}
            onChange={(event) => setArchiveDays(event.target.value)}
          />
          {submitted && !archiveValid ? (
            <p className="text-xs text-destructive-foreground" role="alert">
              {t("agentLayer:settings.validation.archiveRange", {
                min: ARCHIVE_DAYS_RANGE.min,
                max: ARCHIVE_DAYS_RANGE.max,
              })}
            </p>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={isSaving || !isDirty || corePathErrors.length > 0}
            data-testid="settings-save"
          >
            {isSaving
              ? t("agentLayer:settings.saving")
              : t("agentLayer:settings.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
