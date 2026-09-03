import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import { cn } from "@/lib/cn";
import {
  buildDomainTree,
  domainPathLabel,
  flattenDomainTree,
} from "./domain-tree";

// Base UI's Select cannot carry `null` as an item value, so "none" is a
// sentinel that never collides with an id (ids are cuid2, no dots).
const NONE = ".none";

type DomainSelectProps = {
  id?: string;
  nodes: AgentDomainNode[] | undefined;
  value: string | null;
  onChange: (domainId: string | null) => void;
  /** Ids that cannot be chosen (a page and its descendants during a move). */
  excludeIds?: Set<string>;
  noneLabel?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  "data-testid"?: string;
};

/** One domain page or none, indented by depth. */
export function DomainSelect({
  id,
  nodes,
  value,
  onChange,
  excludeIds,
  noneLabel,
  disabled,
  size = "default",
  className,
  "data-testid": testId,
}: DomainSelectProps) {
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      flattenDomainTree(buildDomainTree(nodes)).filter(
        (node) => !excludeIds?.has(node.id),
      ),
    [nodes, excludeIds],
  );
  const selectedLabel = value ? domainPathLabel(nodes, value) : null;
  const none = noneLabel ?? t("agentLayer:domain.none");

  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(!next || next === NONE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn("max-w-full", className)}
        data-testid={testId ?? "domain-select"}
      >
        <SelectValue>
          <span
            className={cn(
              "truncate",
              !selectedLabel && "text-muted-foreground",
            )}
          >
            {selectedLabel ?? none}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{none}</SelectItem>
        {options.map((node) => (
          <SelectItem
            key={node.id}
            value={node.id}
            data-testid="domain-option"
            data-depth={node.depth}
          >
            <span
              className="flex min-w-0 items-baseline gap-2"
              style={{ paddingLeft: `${node.depth * 0.75}rem` }}
            >
              <span className="truncate">{node.title}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {node.slug}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type DomainCheckListProps = {
  nodes: AgentDomainNode[] | undefined;
  value: string[];
  onChange: (domainIds: string[]) => void;
  max?: number;
  disabled?: boolean;
  className?: string;
};

/**
 * Several domain pages, as an indented checkbox list. A form field rather
 * than a popover: the settings page is the one place this appears, the
 * whole tree fits on screen, and the saved state should be readable without
 * opening anything.
 */
export function DomainCheckList({
  nodes,
  value,
  onChange,
  max,
  disabled,
  className,
}: DomainCheckListProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const options = useMemo(
    () => flattenDomainTree(buildDomainTree(nodes)),
    [nodes],
  );
  const selected = new Set(value);
  const atMax = max !== undefined && selected.size >= max;

  if (options.length === 0) {
    return (
      <p
        className={cn("text-xs text-muted-foreground", className)}
        data-testid="domain-check-list-empty"
      >
        {t("agentLayer:domain.noneYet")}
      </p>
    );
  }

  return (
    <ul
      className={cn(
        "max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-background p-2",
        className,
      )}
      data-testid="domain-check-list"
    >
      {options.map((node) => {
        const checked = selected.has(node.id);
        const inputId = `${baseId}-${node.id}`;
        return (
          <li
            key={node.id}
            className="flex items-center gap-2 py-0.5 text-sm"
            style={{ paddingLeft: `${node.depth * 1.25}rem` }}
          >
            <Checkbox
              id={inputId}
              checked={checked}
              disabled={disabled || (!checked && atMax)}
              data-testid="domain-check"
              data-domain-id={node.id}
              onCheckedChange={(next) => {
                const out = new Set(selected);
                if (next) out.add(node.id);
                else out.delete(node.id);
                onChange(
                  options
                    .filter((option) => out.has(option.id))
                    .map((option) => option.id),
                );
              }}
            />
            <label htmlFor={inputId} className="min-w-0 truncate">
              {node.title}
            </label>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
              {node.slug}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
