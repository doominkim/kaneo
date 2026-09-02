import { useMemo } from "react";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";

/** userId → display name, for `updatedBy` on documents. */
export function useMemberNames(workspaceId: string) {
  const { data } = useGetActiveWorkspaceUsers(workspaceId);
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const member of data?.members ?? []) {
      const label = member.user?.name || member.user?.email || member.userId;
      names.set(member.userId, label);
    }
    return names;
  }, [data]);
}
