import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAgentProjectSettings } from "@/hooks/queries/agent-layer/use-agent-project-settings";
import { DomainChip } from "./domain-chip";

type RelatedDomainsProps = {
  workspaceId: string;
  projectId: string;
  canEditSettings: boolean;
};

/** Overview strip: the domain pages the project's settings link to. */
export function RelatedDomains({
  workspaceId,
  projectId,
  canEditSettings,
}: RelatedDomainsProps) {
  const { t } = useTranslation();
  const settings = useAgentProjectSettings(projectId);
  const domains = settings.data?.domains ?? [];

  if (!settings.data) return null;

  return (
    <section className="space-y-2" data-testid="related-domains">
      <h2 className="text-sm font-semibold text-foreground">
        {t("agentLayer:overview.relatedDomains")}
      </h2>
      {domains.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {domains.map((domain) => (
            <DomainChip
              key={domain.id}
              workspaceId={workspaceId}
              domain={domain}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:overview.relatedDomainsEmpty")}{" "}
          {canEditSettings ? (
            <Link
              to="/dashboard/settings/projects/$projectId/agent-layer"
              params={{ projectId }}
              className="underline-offset-2 hover:underline"
            >
              {t("agentLayer:overview.relatedDomainsSettings")}
            </Link>
          ) : null}
        </p>
      )}
    </section>
  );
}
