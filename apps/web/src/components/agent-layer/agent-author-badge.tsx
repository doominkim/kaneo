import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export type AgentAuthorActor = {
  id: string;
  provider: string;
  model: string;
  onBehalfOf: string | null;
};

type AgentAuthorBadgeProps = {
  /** The agent that wrote the record, from the API's `actor` block. */
  actor?: AgentAuthorActor | null;
  /** Resolved display name of the human author, when a person wrote it. */
  humanName?: string | null;
  className?: string;
};

/**
 * Who wrote an agent-layer record, in one place.
 *
 * Every surface used to fall back to a flat "Agent" label whenever there was no
 * human author, which collapsed every model into one word — the reader could
 * not tell an Opus session from a GPT one on a page whose whole purpose is
 * telling them apart. The model id is shown verbatim, exactly as the harness
 * reported it: mapping `claude-fable-5-1` to a prettier name would invent a
 * fact the API never asserted, and the ids are what people search for.
 *
 * The flat label survives as the last resort only: a record written before
 * actors existed has an `actorId` of null and nothing better to say.
 */
export function AgentAuthorBadge({
  actor,
  humanName,
  className,
}: AgentAuthorBadgeProps) {
  const { t } = useTranslation();

  if (humanName) {
    return <span className={className}>{humanName}</span>;
  }

  if (actor) {
    const providerModel = `${actor.provider}/${actor.model}`;
    return (
      <Badge
        variant="info"
        size="sm"
        // `onBehalfOf` is the user id the API returns; "Claude did it" is not
        // enough on a team, "whose Claude did it" is.
        title={
          actor.onBehalfOf
            ? `${providerModel} · ${actor.onBehalfOf}`
            : providerModel
        }
        className={cn("max-w-full font-mono", className)}
        data-testid="agent-author"
      >
        <span className="truncate">{actor.model}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="info"
      size="sm"
      className={className}
      data-testid="agent-author"
    >
      {t("agentLayer:common.agent")}
    </Badge>
  );
}
