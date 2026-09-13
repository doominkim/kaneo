import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const FEATURE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

type CreateFeatureDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFeatures: Set<string>;
  dialogTitle: string;
  isPending: boolean;
  onCreate: (input: { feature: string; title: string }) => Promise<void>;
};

/** Shared by the requirements and design tabs: a feature slug plus a title. */
export function CreateFeatureDialog({
  open,
  onOpenChange,
  existingFeatures,
  dialogTitle,
  isPending,
  onCreate,
}: CreateFeatureDialogProps) {
  const { t } = useTranslation();
  const [feature, setFeature] = useState("");
  const [title, setTitle] = useState("");
  const trimmedFeature = feature.trim();
  const featureInvalid =
    trimmedFeature.length > 0 && !FEATURE_PATTERN.test(trimmedFeature);
  const featureExists = existingFeatures.has(trimmedFeature);
  const canCreate =
    !isPending &&
    trimmedFeature.length > 0 &&
    !featureInvalid &&
    !featureExists &&
    title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {t("agentLayer:spec.featureHint")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canCreate) return;
            await onCreate({ feature: trimmedFeature, title: title.trim() });
            setFeature("");
            setTitle("");
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="spec-feature">{t("agentLayer:spec.feature")}</Label>
            <Input
              id="spec-feature"
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
              placeholder="basic-info-approval"
              autoFocus
              data-testid="feature-input"
            />
            {featureInvalid ? (
              <p className="text-xs text-destructive">
                {t("agentLayer:spec.featureInvalid")}
              </p>
            ) : featureExists ? (
              <p className="text-xs text-destructive">
                {t("agentLayer:spec.featureExists")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="spec-title">{t("agentLayer:spec.title")}</Label>
            <Input
              id="spec-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              data-testid="title-input"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("agentLayer:spec.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!canCreate}
              data-testid="create-feature"
            >
              {t("agentLayer:spec.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
