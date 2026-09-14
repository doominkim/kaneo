import { useEffect, useRef, useState } from "react";

type ReviewOnOpenOptions = {
  /** The item on screen. A different id is a different opening. */
  itemId: string | null | undefined;
  /** Only `false` triggers a review; `undefined` means the item has not loaded. */
  reviewed: boolean | null | undefined;
  /** Calls the review route. Errors are left to the mutation cache. */
  onReview: () => unknown;
  /** Off for deleted items and for viewers the route would refuse. */
  enabled?: boolean;
};

/**
 * Agent writes apply at once and stay unreviewed until a person opens them
 * (agent-autoapply). This marks the item on screen reviewed exactly once per
 * mounted detail: re-renders, refetches and a failed call do not repeat it.
 *
 * Returns whether the item was unreviewed when it was opened. The review's
 * refetch clears `reviewed`, and a mark that vanished the moment it rendered
 * would tell the reader nothing, so the detail keeps it for this visit.
 */
export function useReviewOnOpen({
  itemId,
  reviewed,
  onReview,
  enabled = true,
}: ReviewOnOpenOptions): boolean {
  const reviewedIds = useRef(new Set<string>());
  const [openedUnreviewed, setOpenedUnreviewed] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !itemId || reviewed !== false) return;
    if (reviewedIds.current.has(itemId)) return;
    reviewedIds.current.add(itemId);
    setOpenedUnreviewed(itemId);
    void Promise.resolve(onReview()).catch(() => undefined);
  }, [enabled, itemId, reviewed, onReview]);

  if (!itemId) return false;
  return reviewed === false || openedUnreviewed === itemId;
}
