import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import type { AgentRequirementItem } from "@/fetchers/agent-layer/agent-requirements";
import { cn } from "@/lib/cn";
import { RequirementKeyChip } from "./spec-badges";

const STORY_RE = /^##\s+(.+?)\s*$/;
const NUMBERED_RE = /^(\s*)(\d+)\.\s+(.*?)\s*$/;
const STRIKE_RE = /^~~(.*)~~$/;
const BADGE_RE = /`(unit|api|e2e)`\s*$/;
const KEY_RE = /\s*(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)\s*$/;
/** The subject that splits a Korean criterion into condition and result (REQ-FEATURE-HUB-21). */
const SUBJECT = "시스템은";

export type DocSegment =
  | { kind: "markdown"; text: string }
  | {
      kind: "criterion";
      key: string | null;
      text: string;
      layer: string;
      story: string | null;
      /** 1-based story index; 0 when the line sits before any story */
      storyIndex: number;
      /** 1-based position inside its story */
      index: number;
      dropped: boolean;
    };

/**
 * Client-side mirror of the API parser: splits the document into markdown
 * runs and criterion lines so the page can render prose as prose and each
 * criterion as a row with its badge, coverage and links (REQ-FEATURE-HUB-20).
 * Only the shape is mirrored; the API remains the one that issues keys.
 */
export function parseDocForView(body: string): DocSegment[] {
  const segments: DocSegment[] = [];
  let run: string[] = [];
  let story: string | null = null;
  let storyIndex = 0;
  let index = 0;
  let inFence = false;
  const flush = () => {
    if (run.length) segments.push({ kind: "markdown", text: run.join("\n") });
    run = [];
  };
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const heading = STORY_RE.exec(line);
      if (heading?.[1]) {
        story = heading[1];
        storyIndex += 1;
        index = 0;
        run.push(line);
        continue;
      }
      const numbered = story !== null ? NUMBERED_RE.exec(line) : null;
      if (numbered) {
        let content = numbered[3] ?? "";
        const strike = STRIKE_RE.exec(content);
        if (strike?.[1] !== undefined) content = strike[1].trim();
        const keyMatch = KEY_RE.exec(content);
        const key = keyMatch?.[1] ?? null;
        if (keyMatch) content = content.slice(0, keyMatch.index).trim();
        const badge = BADGE_RE.exec(content);
        if (badge?.[1]) {
          flush();
          index += 1;
          segments.push({
            kind: "criterion",
            key,
            text: content.slice(0, badge.index).trim(),
            layer: badge[1],
            story,
            storyIndex,
            index,
            dropped: Boolean(strike),
          });
          continue;
        }
      }
    }
    run.push(line);
  }
  flush();
  return segments;
}

/** True when the body carries criterion lines, i.e. the document is the source of truth. */
export function isDocMode(body: string): boolean {
  return parseDocForView(body).some((segment) => segment.kind === "criterion");
}

/** `n.m` display number for a key, from the document's story order. */
export function criterionNumbers(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const segment of parseDocForView(body)) {
    if (segment.kind === "criterion" && segment.key) {
      map.set(segment.key, `${segment.storyIndex}.${segment.index}`);
    }
  }
  return map;
}

type RequirementDocProps = {
  body: string;
  items: AgentRequirementItem[];
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
};

export function RequirementDoc({
  body,
  items,
  workspaceId,
  projectId,
  projectSlug,
}: RequirementDocProps) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const segments = parseDocForView(body);
  return (
    <div className="space-y-2" data-testid="requirement-doc">
      {segments.map((segment, i) =>
        segment.kind === "markdown" ? (
          <div
            key={`md-${i.toString()}`}
            className="prose prose-sm max-w-none dark:prose-invert"
          >
            <MarkdownRenderer content={segment.text} />
          </div>
        ) : (
          <CriterionRow
            key={segment.key ?? `new-${i.toString()}`}
            segment={segment}
            item={segment.key ? byKey.get(segment.key) : undefined}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={projectSlug}
          />
        ),
      )}
    </div>
  );
}

function splitAtSubject(text: string): [string, string] {
  const at = text.indexOf(SUBJECT);
  if (at <= 0) return ["", text];
  return [text.slice(0, at).trim(), text.slice(at).trim()];
}

function CriterionRow({
  segment,
  item,
  workspaceId,
  projectId,
  projectSlug,
}: {
  segment: Extract<DocSegment, { kind: "criterion" }>;
  item: AgentRequirementItem | undefined;
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [condition, result] = splitAtSubject(segment.text);
  const covered = (item?.coverage.length ?? 0) > 0;
  const number = `${segment.storyIndex}.${segment.index}`;
  const hasLinks = Boolean(
    item && (item.designs.length || item.tasks.length || item.coverage.length),
  );

  return (
    <div
      className={cn(
        "ml-1 flex items-start gap-2 rounded-md px-2 py-1 text-sm",
        segment.dropped && "text-muted-foreground line-through",
      )}
      data-testid="criterion-row"
      data-key={segment.key ?? ""}
    >
      <span
        className="w-8 shrink-0 font-mono text-xs text-muted-foreground"
        data-testid="criterion-number"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-6">
          {condition ? (
            <span
              className="text-muted-foreground"
              data-testid="criterion-condition"
            >
              {condition}{" "}
            </span>
          ) : null}
          <span data-testid="criterion-result">{result}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            size="sm"
            className="text-[10px]"
            data-testid="criterion-layer"
          >
            {segment.layer}
          </Badge>
          <span
            className={cn(
              "size-2 rounded-full",
              covered ? "bg-success" : "bg-muted-foreground/40",
            )}
            title={
              covered
                ? t("agentLayer:spec.covered", {
                    count: item?.coverage.length ?? 0,
                  })
                : t("agentLayer:spec.notCovered")
            }
            data-testid="criterion-covered"
            data-covered={String(covered)}
          />
          {segment.key ? (
            <RequirementKeyChip
              requirementKey={segment.key}
              muted
              className="text-[10px]"
            />
          ) : null}
          {hasLinks ? (
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((v) => !v)}
              data-testid="criterion-toggle"
            >
              {open ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {item?.designs.length ?? 0}·{item?.tasks.length ?? 0}·
              {item?.coverage.length ?? 0}
            </button>
          ) : null}
        </div>
        {open && item ? (
          <div
            className="mt-1 space-y-0.5 text-xs text-muted-foreground"
            data-testid="criterion-links"
          >
            {item.designs.map((design) => (
              <div key={design.id}>
                <Link
                  to="/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature"
                  params={{ workspaceId, projectId, feature: design.feature }}
                  search={{ tab: "design" }}
                  className="font-mono underline-offset-2 hover:underline"
                >
                  design:{design.feature}
                </Link>
              </div>
            ))}
            {item.tasks.map((task) => (
              <div key={task.id}>
                <Link
                  to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                  params={{ workspaceId, projectId, taskId: task.id }}
                  className="underline-offset-2 hover:underline"
                >
                  {projectSlug && task.number
                    ? `${projectSlug}-${task.number} `
                    : ""}
                  {task.title}
                </Link>
              </div>
            ))}
            {item.coverage.map((c) => (
              <div key={`${c.repo}:${c.testPath}`} className="font-mono">
                {c.repo}: {c.testPath}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
