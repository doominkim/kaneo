/**
 * Stale is never stored (KAN-19 decision): it is the answer to "did something
 * upstream change after this was last revised or acknowledged?", computed
 * from timestamps on read. Nothing here touches the database.
 *
 * Every save applies immediately (agent-autoapply), so the clocks are content
 * clocks rather than approval clocks: a design's `revisedAt` moves only when
 * its title, body or covered requirement keys actually change.
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
 * A design is stale when a requirement it covers changed after the design's
 * content was last revised. Revising the design moves its clock past those
 * changes, which is how staleness clears.
 */
export function designStale(revisedAt: Date, items: ItemClock[]): StaleVerdict {
  const causes = items
    .filter((item) => item.updatedAt.getTime() > revisedAt.getTime())
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
  /** item.updatedAt for a requirement link, design.revisedAt for a design link */
  upstreamChangedAt: Date;
  createdAt: Date;
  acknowledgedAt: Date | null;
};

/**
 * A task link's clock is the last acknowledgement, or the moment the link was
 * made. Upstream moving past that clock makes the task stale. A design link
 * can only be made once the design exists, so its first revision never
 * predates the link; a later content revision does.
 */
export function taskStale(links: TaskLinkClock[]): StaleVerdict {
  const causes: StaleCause[] = [];
  for (const link of links) {
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
