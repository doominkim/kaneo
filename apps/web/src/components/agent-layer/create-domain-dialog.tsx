import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import type { AgentDomain } from "@/fetchers/agent-layer/create-agent-domain";
import { useCreateAgentDomain } from "@/hooks/mutations/agent-layer/use-create-agent-domain";
import { toast } from "@/lib/toast";
import {
  DOMAIN_SLUG_PATTERN,
  MAX_DOMAIN_TITLE_LENGTH,
  randomSlugFallback,
  slugFromTitle,
} from "./domain-tree";

type CreateDomainDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Null for a root page. */
  parent: { id: string; title: string } | null;
  onCreated: (domain: AgentDomain) => void;
};

/**
 * New domain page. The slug follows the title until the user edits it by
 * hand; after that the title no longer touches it. A title with no ASCII
 * (the usual case: 약국, 약사) falls back to `domain-xxxxxx`, fixed for the
 * life of the dialog, so nobody has to invent a slug to save a page. The
 * slug sits behind a disclosure: it is identity, not content.
 */
export function CreateDomainDialog({
  open,
  onOpenChange,
  workspaceId,
  parent,
  onCreated,
}: CreateDomainDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fallback, setFallback] = useState(randomSlugFallback);
  const [slugOpen, setSlugOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useCreateAgentDomain();

  useEffect(() => {
    if (!slugEdited) setSlug(slugFromTitle(title) || fallback);
  }, [title, slugEdited, fallback]);

  const reset = () => {
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setFallback(randomSlugFallback());
    setSlugOpen(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedTitle) {
      setError(t("agentLayer:domain.titleRequired"));
      return;
    }
    if (!DOMAIN_SLUG_PATTERN.test(trimmedSlug)) {
      setSlugOpen(true);
      setError(t("agentLayer:domain.slugInvalid"));
      return;
    }
    try {
      const created = await mutateAsync({
        workspaceId,
        body: {
          parentId: parent?.id ?? null,
          slug: trimmedSlug,
          title: trimmedTitle,
          body: "",
        },
      });
      toast.success(t("agentLayer:domain.created", { title: trimmedTitle }));
      reset();
      onCreated(created);
    } catch (cause) {
      if (isAgentLayerStatus(cause, 409)) {
        setSlugOpen(true);
        setError(t("agentLayer:domain.slugExists"));
        return;
      }
      if (isAgentLayerStatus(cause, 400)) {
        setError(cause instanceof Error ? cause.message : null);
        return;
      }
      toast.error(t("agentLayer:domain.createFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="create-domain-dialog">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {parent
                ? t("agentLayer:domain.createChildTitle", {
                    parent: parent.title,
                  })
                : t("agentLayer:domain.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("agentLayer:domain.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-domain-title">
                {t("agentLayer:domain.titleLabel")}
              </Label>
              <Input
                id="agent-domain-title"
                value={title}
                autoFocus
                autoComplete="off"
                maxLength={MAX_DOMAIN_TITLE_LENGTH}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <Collapsible open={slugOpen} onOpenChange={setSlugOpen}>
              <CollapsibleTrigger
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground data-panel-open:[&_svg]:rotate-90"
                data-testid="slug-toggle"
              >
                <ChevronRight className="size-3.5 transition-transform duration-200" />
                <span>{t("agentLayer:domain.slugLabel")}</span>
                <span
                  className="font-mono text-foreground/80"
                  data-testid="slug-preview"
                >
                  {slug}
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="agent-domain-slug" className="sr-only">
                    {t("agentLayer:domain.slugLabel")}
                  </Label>
                  <Input
                    id="agent-domain-slug"
                    value={slug}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="pharmacy"
                    className="font-mono"
                    onChange={(event) => {
                      setSlugEdited(true);
                      setSlug(event.target.value.toLowerCase());
                      setError(null);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("agentLayer:domain.slugHint")}
                  </p>
                </div>
              </CollapsiblePanel>
            </Collapsible>
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
              disabled={isPending}
              data-testid="create-domain-submit"
            >
              {isPending
                ? t("agentLayer:domain.creating")
                : t("agentLayer:domain.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
