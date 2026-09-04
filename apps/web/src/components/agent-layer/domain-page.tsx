import { Link } from "@tanstack/react-router";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import type { AgentDomain } from "@/fetchers/agent-layer/create-agent-domain";
import type { AgentDomainPage } from "@/fetchers/agent-layer/get-agent-domain";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import { useDeleteAgentDomain } from "@/hooks/mutations/agent-layer/use-delete-agent-domain";
import { useUpdateAgentDomain } from "@/hooks/mutations/agent-layer/use-update-agent-domain";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { CreateDomainDialog } from "./create-domain-dialog";
import { MAX_DOMAIN_BODY_BYTES } from "./domain-tree";
import { EntryAuthor } from "./entry-author";
import { MoveDomainDialog } from "./move-domain-dialog";
import { TermList } from "./term-list";

const encoder = new TextEncoder();

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

type DomainPageProps = {
  page: AgentDomainPage;
  workspaceId: string;
  /** The flat tree, for the move dialog's target list. */
  nodes: AgentDomainNode[] | undefined;
  /** task:update — edit the body, add a sub-page. */
  canEdit: boolean;
  /** workspace:update — move and delete. */
  canManage: boolean;
  onOpen: (domainId: string) => void;
  onDeleted: (parentId: string | null) => void;
};

/**
 * One domain page (KAN-14): breadcrumb, markdown body, and everything the
 * API aggregated under it. Knowledge items are reviewed here (KAN-16) — the
 * page a reviewer already has open is the one that carries the context the
 * decision needs.
 */
export function DomainPage({
  page,
  workspaceId,
  nodes,
  canEdit,
  canManage,
  onOpen,
  onDeleted,
}: DomainPageProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const update = useUpdateAgentDomain();
  const remove = useDeleteAgentDomain();

  // A refetch replaces the baseline only while viewing, so an edit in
  // progress is never clobbered by someone else's save.
  useEffect(() => {
    if (!isEditing) {
      setTitle(page.title);
      setBody(page.body);
    }
  }, [page.title, page.body, isEditing]);

  const bytes = encoder.encode(body).length;
  const tooLarge = bytes > MAX_DOMAIN_BODY_BYTES;
  const trimmedTitle = title.trim();
  const canSave = !update.isPending && !tooLarge && trimmedTitle.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await update.mutateAsync({
        workspaceId,
        domainId: page.id,
        body: { title: trimmedTitle, body },
      });
      toast.success(t("agentLayer:domain.saved"));
      setIsEditing(false);
    } catch (cause) {
      toast.error(t("agentLayer:domain.saveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const handleCancel = () => {
    setTitle(page.title);
    setBody(page.body);
    setIsEditing(false);
  };

  // 409 lists what still hangs under the page (children, terms, documents,
  // projects); the counts come from the API and are shown as written.
  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await remove.mutateAsync({ workspaceId, domainId: page.id });
      toast.success(t("agentLayer:domain.deleted", { title: page.title }));
      setIsDeleteOpen(false);
      onDeleted(page.parentId);
    } catch (cause) {
      if (isAgentLayerStatus(cause, 409)) {
        setDeleteError(cause instanceof Error ? cause.message : null);
        return;
      }
      toast.error(t("agentLayer:domain.deleteFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-4 sm:px-4">
      <Breadcrumb data-testid="domain-breadcrumb">
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <FolderTree className="size-3.5" />
              {t("agentLayer:nav.domains")}
            </span>
          </BreadcrumbItem>
          {page.ancestors.map((ancestor) => (
            <Fragment key={ancestor.id}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink
                  render={
                    <Link
                      to="/dashboard/workspace/$workspaceId/domain/$domainId"
                      params={{ workspaceId, domainId: ancestor.id }}
                    />
                  }
                  data-testid="breadcrumb-ancestor"
                >
                  {ancestor.title}
                </BreadcrumbLink>
              </BreadcrumbItem>
            </Fragment>
          ))}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{page.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          {isEditing ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label={t("agentLayer:domain.titleLabel")}
              className="min-w-0 flex-1 [&_[data-slot=input]]:text-lg [&_[data-slot=input]]:font-semibold"
            />
          ) : (
            <h1
              className="min-w-0 flex-1 text-xl font-semibold leading-snug text-foreground"
              data-testid="domain-title"
            >
              {page.title}
            </h1>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {isEditing ? (
              <>
                <span
                  data-testid="byte-counter"
                  className={cn(
                    "text-xs tabular-nums",
                    tooLarge
                      ? "text-destructive-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {t("agentLayer:domain.byteCounter", {
                    used: formatBytes(bytes),
                    max: formatBytes(MAX_DOMAIN_BODY_BYTES),
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={update.isPending}
                >
                  {t("agentLayer:domain.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!canSave}
                  data-testid="save-domain"
                >
                  {update.isPending
                    ? t("agentLayer:domain.saving")
                    : t("agentLayer:domain.save")}
                </Button>
              </>
            ) : (
              <>
                {canEdit ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    data-testid="edit-domain"
                  >
                    <Pencil className="size-3.5" />
                    {t("agentLayer:domain.edit")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsMoveOpen(true)}
                    data-testid="move-domain"
                  >
                    <FolderTree className="size-3.5" />
                    {t("agentLayer:domain.move")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    variant="destructive-outline"
                    size="sm"
                    onClick={() => {
                      setDeleteError(null);
                      setIsDeleteOpen(true);
                    }}
                    data-testid="delete-domain"
                  >
                    <Trash2 className="size-3.5" />
                    {t("agentLayer:domain.delete")}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{page.slug}</span>
          <span aria-hidden="true">·</span>
          <EntryAuthor entry={{ author: page.author, actor: page.actor }} />
          <span title={formatDateTime(page.updatedAt)}>
            {formatRelativeTime(page.updatedAt)}
          </span>
        </div>
      </header>

      {isEditing ? (
        <div className="space-y-1.5" data-testid="domain-editor">
          {/* No taskId: the upload path needs one (DESIGN.md §10), so
              attachments stay off, as on project documents. */}
          <CommentEditor
            value={body}
            onChange={setBody}
            placeholder={t("agentLayer:domain.bodyPlaceholder")}
            showQuickAttachButton={false}
            className="min-h-[20rem] rounded-lg border border-border/80"
          />
          <p className="text-xs text-muted-foreground">
            {t("agentLayer:domain.attachmentsDisabled")}
          </p>
        </div>
      ) : page.body.trim() ? (
        <article data-testid="domain-body">
          <MarkdownRenderer content={page.body} />
        </article>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="domain-body">
          {t("agentLayer:domain.emptyBody")}
        </p>
      )}

      <section className="space-y-2" data-testid="domain-children">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t("agentLayer:domain.children")}
          </h2>
          {canEdit ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setIsCreateOpen(true)}
              data-testid="add-child-domain"
            >
              <Plus />
              {t("agentLayer:domain.addChild")}
            </Button>
          ) : null}
        </div>
        {page.children.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("agentLayer:domain.childrenEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-md border border-border/80 bg-sidebar">
            {page.children.map((child) => (
              <li key={child.id}>
                <Link
                  to="/dashboard/workspace/$workspaceId/domain/$domainId"
                  params={{ workspaceId, domainId: child.id }}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40"
                  data-testid="child-link"
                >
                  <span className="truncate">{child.title}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {child.slug}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Review lives here rather than in the knowledge tab: judging a proposal
        needs the domain it belongs to, and that context is this page. The
        list is fetched rather than read off `page.terms`, which carries only
        id/canonical/confidence/state — not the definition, proposer or
        reviewer a decision rests on.
      */}
      <section className="space-y-2" data-testid="domain-terms">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("agentLayer:domain.terms")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("agentLayer:domain.termsHint")}
          </p>
        </div>
        <TermList
          workspaceId={workspaceId}
          canReview={canManage}
          domainId={page.id}
        />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2" data-testid="domain-projects">
          <h2 className="text-sm font-semibold text-foreground">
            {t("agentLayer:domain.projects")}
          </h2>
          {page.projects.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("agentLayer:domain.projectsEmpty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {page.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/overview"
                    params={{ workspaceId, projectId: project.id }}
                    className="text-sm underline-offset-2 hover:underline"
                    data-testid="domain-project"
                  >
                    {project.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2" data-testid="domain-documents">
          <h2 className="text-sm font-semibold text-foreground">
            {t("agentLayer:domain.documents")}
          </h2>
          {page.documents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("agentLayer:domain.documentsEmpty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {page.documents.map((document) => (
                <li key={document.id} className="min-w-0">
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug"
                    params={{
                      workspaceId,
                      projectId: document.projectId,
                      slug: document.slug,
                    }}
                    className="block truncate text-sm underline-offset-2 hover:underline"
                    title={formatDateTime(document.updatedAt)}
                    data-testid="domain-document"
                  >
                    {document.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CreateDomainDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        workspaceId={workspaceId}
        parent={{ id: page.id, title: page.title }}
        onCreated={(created: AgentDomain) => {
          setIsCreateOpen(false);
          onOpen(created.id);
        }}
      />

      {canManage ? (
        <MoveDomainDialog
          key={`${page.id}:${page.parentId ?? "root"}`}
          open={isMoveOpen}
          onOpenChange={setIsMoveOpen}
          workspaceId={workspaceId}
          domain={{ id: page.id, title: page.title, parentId: page.parentId }}
          nodes={nodes}
        />
      ) : null}

      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setIsDeleteOpen(false);
        }}
      >
        <AlertDialogContent data-testid="delete-domain-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentLayer:domain.deleteTitle", { title: page.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:domain.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p
              className="px-6 pb-4 text-xs text-destructive-foreground"
              role="alert"
              data-testid="delete-domain-error"
            >
              {t("agentLayer:domain.deleteRefused")} {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("agentLayer:domain.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={remove.isPending}
              data-testid="confirm-delete-domain"
            >
              {remove.isPending
                ? t("agentLayer:domain.deleting")
                : t("agentLayer:domain.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
