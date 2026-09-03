import { User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { type AgentAuthorActor, AgentAuthorBadge } from "./agent-author-badge";

export type EntryAuthorship = {
  actor: AgentAuthorActor | null;
  author: { userId: string; name: string } | null;
  agentLabel?: string | null;
  effort?: string | null;
};

/**
 * Who wrote a ledger entry. The stream interleaves people and agents, so the
 * reader must be able to tell them apart at a glance: a person is their name
 * with a small "person" marker, an agent is the model badge (KAN-11) followed
 * by the harness label and effort. Both null means the author row was
 * deleted — say so rather than fall back to a flat "Agent", which would
 * misattribute a person's note.
 */
export function EntryAuthor({
  entry,
  className,
}: {
  entry: EntryAuthorship;
  className?: string;
}) {
  const { t } = useTranslation();

  if (entry.author) {
    return (
      <span
        data-testid="entry-author"
        data-author-kind="human"
        className={cn("inline-flex min-w-0 items-center gap-1", className)}
      >
        <span className="truncate text-foreground/90">{entry.author.name}</span>
        <Badge
          variant="outline"
          size="sm"
          className="text-muted-foreground"
          title={t("agentLayer:common.human")}
        >
          <User />
          {t("agentLayer:common.human")}
        </Badge>
      </span>
    );
  }

  if (entry.actor) {
    const detail = [entry.agentLabel ?? null, entry.effort ?? null]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    return (
      <span
        data-testid="entry-author"
        data-author-kind="agent"
        className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      >
        <AgentAuthorBadge actor={entry.actor} />
        {detail ? <span className="truncate">{detail}</span> : null}
      </span>
    );
  }

  return (
    <span
      data-testid="entry-author"
      data-author-kind="unknown"
      className={cn("text-muted-foreground", className)}
    >
      {t("agentLayer:common.unknownAuthor")}
    </span>
  );
}

/** Plain-text form of the same rule, for footers that join with " · ". */
export function authorText(entry: EntryAuthorship, t: (key: string) => string) {
  if (entry.author) return entry.author.name;
  if (entry.actor) {
    return [
      `${entry.actor.provider}/${entry.actor.model}`,
      entry.agentLabel ?? null,
      entry.effort ?? null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }
  return t("agentLayer:common.unknownAuthor");
}
