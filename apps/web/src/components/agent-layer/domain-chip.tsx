import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type DomainChipProps = {
  workspaceId: string;
  domain: { id: string; slug: string; title: string };
  className?: string;
};

/** A link to a domain page, shown wherever something is filed under one. */
export function DomainChip({
  workspaceId,
  domain,
  className,
}: DomainChipProps) {
  return (
    <Link
      to="/dashboard/workspace/$workspaceId/domain/$domainId"
      params={{ workspaceId, domainId: domain.id }}
      className="inline-flex max-w-full"
      data-testid="domain-chip"
      data-domain-id={domain.id}
    >
      <Badge
        variant="outline"
        size="sm"
        className={cn("max-w-full hover:bg-accent", className)}
        title={domain.slug}
      >
        <BookOpen />
        <span className="truncate">{domain.title}</span>
      </Badge>
    </Link>
  );
}
