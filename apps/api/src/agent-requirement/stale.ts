/**
 * Stale is never stored (KAN-19 decision): it is the answer to "did something
 * upstream change after this was last approved or acknowledged?", computed
 * from timestamps on read. Nothing here touches the database.
 */

export type StaleCause = {
  kind: "requirement" | "design";
  key: string;
  changedAt: Date;
};

export type StaleVerdict = {
  stale: boolean;
  causes: StaleCause[];
};

type ItemClock = { key: string; updatedAt: Date };

/**
 * A design is stale when any requirement it covers changed after the design
 * was approved. An unapproved design has no clock yet, so it is not stale —
 * it is simply not approved, which the caller shows separately.
 */
export function designStale(
  approvedAt: Date | null | undefined,
  items: ItemClock[],
): StaleVerdict {
  if (!approvedAt) return { stale: false, causes: [] };
  const causes = items
    .filter((item) => item.updatedAt.getTime() > approvedAt.getTime())
    .map(
      (item): StaleCause => ({
        kind: "requirement",
        key: item.key,
        changedAt: item.updatedAt,
      }),
    );
  return { stale: causes.length > 0, causes };
}

export type TaskLinkClock = {
  kind: "requirement" | "design";
  key: string;
  /** item.updatedAt for a requirement link, design.approvedAt for a design link (null = design not approved yet) */
  upstreamChangedAt: Date | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
};

/**
 * A task link's clock is the last human acknowledgement, or the moment the
 * link was made. Upstream moving past that clock makes the task stale.
 */
export function taskStale(links: TaskLinkClock[]): StaleVerdict {
  const causes: StaleCause[] = [];
  for (const link of links) {
    if (!link.upstreamChangedAt) continue;
    const clock = link.acknowledgedAt ?? link.createdAt;
    if (link.upstreamChangedAt.getTime() > clock.getTime()) {
      causes.push({
        kind: link.kind,
        key: link.key,
        changedAt: link.upstreamChangedAt,
      });
    }
  }
  return { stale: causes.length > 0, causes };
}
