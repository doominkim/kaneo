import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { TermList } from "@/components/agent-layer/term-list";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * A static segment rather than a reserved `$domainId` value: domain ids are
 * server-generated cuids, so "unfiled" can never name a real page, and the
 * router resolves the literal before the dynamic sibling either way.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/domain/unfiled",
)({
  component: RouteComponent,
});

/** 미분류: the workspace knowledge no domain page claims yet (KAN-16). */
function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { canUpdateWorkspace } = useWorkspacePermission();

  return (
    <>
      <PageTitle title={t("agentLayer:domain.unfiledPageTitle")} />
      <WorkspaceLayout title={t("agentLayer:domain.title")}>
        <div className="h-full min-h-0 overflow-y-auto bg-background">
          <div
            className="mx-auto max-w-4xl space-y-4 px-3 py-4 sm:px-4"
            data-testid="unfiled-knowledge"
          >
            <header className="space-y-1">
              <h1 className="text-xl font-semibold leading-snug text-foreground">
                {t("agentLayer:domain.unfiled")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:domain.unfiledHint")}
              </p>
            </header>
            {/* "none" is the API's word for `domain_id IS NULL`. */}
            <TermList
              workspaceId={workspaceId}
              canReview={canUpdateWorkspace()}
              domainId="none"
            />
          </div>
        </div>
      </WorkspaceLayout>
    </>
  );
}
