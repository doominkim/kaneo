import { createFileRoute, redirect } from "@tanstack/react-router";

/** The requirements tab became part of the Feature tab (REQ-FEATURE-HUB-16). */
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/requirements/",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/feature",
      params,
      replace: true,
    });
  },
});
