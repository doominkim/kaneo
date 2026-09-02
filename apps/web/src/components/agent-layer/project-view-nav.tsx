import {
  BookOpen,
  FileText,
  LayoutDashboard,
  NotebookPen,
  SquareKanban,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Every project-level view. The four task views keep their existing URLs; the
 * agent-layer views are siblings added by DESIGN.md §6.
 */
export type ProjectView =
  | "overview"
  | "backlog"
  | "board"
  | "calendar"
  | "gantt"
  | "knowledge"
  | "notes"
  | "docs";

/** Top-level tab. The four task views collapse into one "tasks" section. */
export type ProjectSection =
  | "overview"
  | "tasks"
  | "knowledge"
  | "notes"
  | "docs";

export const PROJECT_VIEW_PATHS = {
  overview: "/dashboard/workspace/$workspaceId/project/$projectId/overview",
  backlog: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
  board: "/dashboard/workspace/$workspaceId/project/$projectId/board",
  calendar: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
  gantt: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
  knowledge: "/dashboard/workspace/$workspaceId/project/$projectId/knowledge",
  notes: "/dashboard/workspace/$workspaceId/project/$projectId/notes",
  docs: "/dashboard/workspace/$workspaceId/project/$projectId/docs",
} as const satisfies Record<ProjectView, string>;

const VIEW_SEGMENT_PATTERN =
  /\/project\/[^/]+\/(overview|knowledge|notes|docs|backlog|board|calendar|gantt)(?:\/|$)/;

export function resolveProjectView(
  pathname: string,
  activeView?: ProjectView,
): ProjectView {
  if (activeView) return activeView;
  const match = VIEW_SEGMENT_PATTERN.exec(pathname);
  return (match?.[1] as ProjectView | undefined) ?? "board";
}

export function sectionOfView(view: ProjectView): ProjectSection {
  switch (view) {
    case "backlog":
    case "board":
    case "calendar":
    case "gantt":
      return "tasks";
    default:
      return view;
  }
}

const SECTIONS: Array<{
  section: ProjectSection;
  view: ProjectView;
  icon: typeof LayoutDashboard;
  labelKey: string;
}> = [
  {
    section: "overview",
    view: "overview",
    icon: LayoutDashboard,
    labelKey: "agentLayer:nav.overview",
  },
  {
    section: "tasks",
    view: "board",
    icon: SquareKanban,
    labelKey: "agentLayer:nav.tasks",
  },
  {
    section: "knowledge",
    view: "knowledge",
    icon: BookOpen,
    labelKey: "agentLayer:nav.knowledge",
  },
  {
    section: "notes",
    view: "notes",
    icon: NotebookPen,
    labelKey: "agentLayer:nav.notes",
  },
  {
    section: "docs",
    view: "docs",
    icon: FileText,
    labelKey: "agentLayer:nav.docs",
  },
];

type ProjectSectionTabsProps = {
  activeView: ProjectView;
  onSelectView: (view: ProjectView) => void;
  className?: string;
};

/** Desktop header: the five top-level tabs. */
export function ProjectSectionTabs({
  activeView,
  onSelectView,
  className,
}: ProjectSectionTabsProps) {
  const { t } = useTranslation();
  const activeSection = sectionOfView(activeView);

  return (
    <nav
      aria-label={t("agentLayer:nav.sections")}
      className={cn(
        "hidden h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5 sm:inline-flex",
        className,
      )}
    >
      {SECTIONS.map(({ section, view, icon: Icon, labelKey }) => {
        const isActive = section === activeSection;
        return (
          <Button
            key={section}
            variant={isActive ? "secondary" : "ghost"}
            size="xs"
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              // Clicking "tasks" while already on a task view keeps that view.
              if (!isActive) onSelectView(view);
            }}
            className={cn(
              "h-6 gap-1.5 rounded-md px-2 text-xs",
              !isActive && "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {t(labelKey)}
          </Button>
        );
      })}
    </nav>
  );
}

type MobileProjectSectionsProps = {
  activeView: ProjectView;
  onSelectView: (view: ProjectView) => void;
};

/** Mobile popover: the same five sections as a compact grid. */
export function MobileProjectSections({
  activeView,
  onSelectView,
}: MobileProjectSectionsProps) {
  const { t } = useTranslation();
  const activeSection = sectionOfView(activeView);

  return (
    <div className="space-y-1">
      <p className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("agentLayer:nav.sections")}
      </p>
      <div className="grid grid-cols-5 gap-1">
        {SECTIONS.map(({ section, view, icon: Icon, labelKey }) => {
          const isActive = section === activeSection;
          return (
            <button
              key={section}
              type="button"
              onClick={() => {
                if (!isActive) onSelectView(view);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors",
                isActive
                  ? "border-border bg-secondary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent",
              )}
            >
              <Icon className="size-3.5" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
