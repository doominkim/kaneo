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
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { usePutAgentDocument } from "@/hooks/mutations/agent-layer/use-put-agent-document";
import { toast } from "@/lib/toast";

// Mirrors apps/api/src/agent-document/schema.ts SLUG_PATTERN; the server is
// still the authority, this only saves a round trip.
export const DOCUMENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

type CreateDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  existingSlugs: Set<string>;
  onCreated: (slug: string) => void;
};

export function CreateDocumentDialog({
  open,
  onOpenChange,
  projectId,
  existingSlugs,
  onCreated,
}: CreateDocumentDialogProps) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = usePutAgentDocument();

  const reset = () => {
    setSlug("");
    setTitle("");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedSlug = slug.trim();
    const trimmedTitle = title.trim();

    if (!DOCUMENT_SLUG_PATTERN.test(trimmedSlug)) {
      setError(t("agentLayer:docs.slugInvalid"));
      return;
    }
    if (existingSlugs.has(trimmedSlug)) {
      setError(t("agentLayer:docs.slugExists"));
      return;
    }
    if (!trimmedTitle) {
      setError(t("agentLayer:docs.titleRequired"));
      return;
    }

    try {
      await mutateAsync({
        projectId,
        slug: trimmedSlug,
        body: { title: trimmedTitle, body: "" },
      });
      toast.success(t("agentLayer:docs.created"));
      reset();
      onCreated(trimmedSlug);
    } catch (cause) {
      if (isAgentLayerStatus(cause, 400)) {
        setError(cause instanceof Error ? cause.message : null);
        return;
      }
      toast.error(t("agentLayer:docs.createFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>{t("agentLayer:docs.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("agentLayer:docs.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-document-slug">
                {t("agentLayer:docs.slugLabel")}
              </Label>
              <Input
                id="agent-document-slug"
                value={slug}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="session-report-2026-09-02"
                onChange={(event) => {
                  setSlug(event.target.value.toLowerCase());
                  setError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:docs.slugHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-document-title">
                {t("agentLayer:docs.titleLabel")}
              </Label>
              <Input
                id="agent-document-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError(null);
                }}
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
              {t("agentLayer:docs.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t("agentLayer:docs.creating")
                : t("agentLayer:docs.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
