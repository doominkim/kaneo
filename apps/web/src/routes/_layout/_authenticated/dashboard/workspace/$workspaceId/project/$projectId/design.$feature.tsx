import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/** Old design links land on the feature's design sub tab (REQ-FEATURE-HUB-16). */
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/design/$feature",
)({
  validateSearch: z.object({ edit: z.boolean().optional() }),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature",
      params,
      search: { tab: "design", edit: search.edit },
      replace: true,
    });
  },
});
