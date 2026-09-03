import { AlertCircle, CheckCircle2, RotateCw, Upload, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUploadAgentArtifact } from "@/hooks/mutations/agent-layer/use-upload-agent-artifact";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  ARTIFACT_CONTENT_TYPES,
  ArtifactUploadError,
  precheckArtifactFile,
} from "@/lib/upload-agent-artifact";
import { formatBytes } from "./artifact-kind";

export type UploadTaskOption = {
  id: string;
  number: number | null;
  title: string;
};

type UploadEntry = {
  id: string;
  file: File;
  taskId: string | null;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: ArtifactUploadError;
};

type ArtifactUploaderProps = {
  projectId: string;
  projectSlug?: string;
  tasks: UploadTaskOption[];
  className?: string;
};

const ACCEPT = [
  ...ARTIFACT_CONTENT_TYPES,
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".txt",
  ".log",
  ".json",
  ".pdf",
  ".zip",
].join(",");

const NO_TASK = "__project__";

let entrySequence = 0;

/**
 * Drop zone + file picker + optional task link. Each file runs the
 * presign → PUT → finalize sequence independently so one rejection does not
 * hold the others; failed rows keep their File so "upload again" is one click.
 */
export function ArtifactUploader({
  projectId,
  projectSlug,
  tasks,
  className,
}: ArtifactUploaderProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [taskId, setTaskId] = useState<string>(NO_TASK);
  const [isDragging, setIsDragging] = useState(false);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const upload = useUploadAgentArtifact();

  const patch = useCallback((id: string, changes: Partial<UploadEntry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...changes } : entry,
      ),
    );
  }, []);

  const run = useCallback(
    async (entry: UploadEntry) => {
      try {
        const artifact = await upload.mutateAsync({
          projectId,
          file: entry.file,
          taskId: entry.taskId,
          onProgress: (fraction) => patch(entry.id, { progress: fraction }),
        });
        patch(entry.id, { status: "done", progress: 1, error: undefined });
        toast.success(t("agentLayer:docs.uploaded", { name: artifact.name }));
      } catch (cause) {
        const error =
          cause instanceof ArtifactUploadError
            ? cause
            : new ArtifactUploadError(
                "finalize",
                "unknown",
                cause instanceof Error ? cause.message : "Upload failed.",
              );
        patch(entry.id, { status: "error", error });
      }
    },
    [upload, projectId, patch, t],
  );

  const enqueue = useCallback(
    (files: FileList | File[]) => {
      const linkedTask = taskId === NO_TASK ? null : taskId;
      const next: UploadEntry[] = [];
      for (const file of Array.from(files)) {
        entrySequence += 1;
        const rejected = precheckArtifactFile(file);
        next.push({
          id: `upload-${entrySequence}`,
          file,
          taskId: linkedTask,
          progress: 0,
          status: rejected ? "error" : "uploading",
          error: rejected ?? undefined,
        });
      }
      if (next.length === 0) return;
      setEntries((current) => [...next, ...current]);
      for (const entry of next) {
        if (entry.status === "uploading") void run(entry);
      }
    },
    [run, taskId],
  );

  const retry = (entry: UploadEntry) => {
    const rejected = precheckArtifactFile(entry.file);
    if (rejected) {
      patch(entry.id, { status: "error", error: rejected });
      return;
    }
    patch(entry.id, { status: "uploading", progress: 0, error: undefined });
    void run({ ...entry, status: "uploading", progress: 0, error: undefined });
  };

  const dismiss = (id: string) =>
    setEntries((current) => current.filter((entry) => entry.id !== id));

  const selectedTask = tasks.find((task) => task.id === taskId);

  return (
    <div className={cn("space-y-2", className)} data-testid="artifact-uploader">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target is a passive surface; the button and input inside carry the keyboard path. */}
      <div
        data-testid="artifact-dropzone"
        data-dragging={isDragging ? "true" : "false"}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (event.dataTransfer.files.length > 0) {
            enqueue(event.dataTransfer.files);
          }
        }}
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-dashed px-4 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Upload className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-sm">
            <p className="text-foreground">
              {t("agentLayer:docs.dropHint")}{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => inputRef.current?.click()}
                data-testid="browse-files"
              >
                {t("agentLayer:docs.browse")}
              </button>
            </p>
            <p className="text-xs text-muted-foreground">
              {t("agentLayer:docs.allowedTypes")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor={`${inputId}-task`} className="sr-only">
            {t("agentLayer:docs.linkTask")}
          </label>
          <Select
            value={taskId}
            onValueChange={(value) => setTaskId(value ?? NO_TASK)}
          >
            <SelectTrigger
              id={`${inputId}-task`}
              size="sm"
              className="w-56 max-w-full"
              data-testid="upload-task-select"
            >
              <SelectValue>
                {selectedTask
                  ? `${projectSlug ? `${projectSlug}-` : "#"}${selectedTask.number ?? "?"} ${selectedTask.title}`
                  : t("agentLayer:docs.noTask")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TASK}>
                {t("agentLayer:docs.noTask")}
              </SelectItem>
              {tasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                    {projectSlug ? `${projectSlug}-` : "#"}
                    {task.number ?? "?"}
                  </span>
                  {task.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          data-testid="artifact-file-input"
          onChange={(event) => {
            if (event.target.files) enqueue(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {entries.length > 0 ? (
        <ul className="space-y-1" data-testid="upload-queue">
          {entries.map((entry) => (
            <UploadRow
              key={entry.id}
              entry={entry}
              onRetry={() => retry(entry)}
              onDismiss={() => dismiss(entry.id)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function describeError(
  error: ArtifactUploadError,
  t: ReturnType<typeof useTranslation>["t"],
) {
  switch (error.reason) {
    case "unsupported-type":
      return t("agentLayer:docs.errorUnsupported");
    case "too-large":
      return t("agentLayer:docs.errorTooLarge");
    case "empty":
      return t("agentLayer:docs.errorEmpty");
    case "storage-unavailable":
      return t("agentLayer:docs.errorStorage");
    case "mismatch":
      return t("agentLayer:docs.errorMismatch");
    case "forbidden":
      return t("agentLayer:docs.errorForbidden");
    case "upload-failed":
      return t("agentLayer:docs.errorPut");
    case "rejected":
      return error.message || t("agentLayer:docs.errorRejected");
    default:
      return error.message || t("agentLayer:docs.uploadFailed");
  }
}

function UploadRow({
  entry,
  onRetry,
  onDismiss,
}: {
  entry: UploadEntry;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const percent = Math.round(entry.progress * 100);

  return (
    <li
      data-testid="upload-row"
      data-status={entry.status}
      className="flex items-center gap-3 rounded-md border border-border/80 bg-background px-3 py-2 text-sm"
    >
      {entry.status === "done" ? (
        <CheckCircle2 className="size-4 shrink-0 text-success-foreground" />
      ) : entry.status === "error" ? (
        <AlertCircle className="size-4 shrink-0 text-destructive-foreground" />
      ) : (
        <Upload className="size-4 shrink-0 animate-pulse text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {entry.file.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(entry.file.size)}
          </span>
        </div>
        {entry.status === "uploading" ? (
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t("agentLayer:docs.uploading")}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : entry.status === "error" && entry.error ? (
          <p
            className="mt-0.5 text-xs text-destructive-foreground"
            role="alert"
            data-testid="upload-error"
          >
            {describeError(entry.error, t)}
          </p>
        ) : null}
      </div>
      {entry.status === "uploading" ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          {percent}%
        </span>
      ) : null}
      {entry.status === "error" && entry.error?.stage !== "precheck" ? (
        <Button
          variant="outline"
          size="xs"
          onClick={onRetry}
          data-testid="retry-upload"
        >
          <RotateCw className="size-3.5" />
          {t("agentLayer:docs.retryUpload")}
        </Button>
      ) : null}
      {entry.status !== "uploading" ? (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          aria-label={t("agentLayer:docs.dismiss")}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
}
