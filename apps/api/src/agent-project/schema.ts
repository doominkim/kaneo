import { z } from "../openapi";
import {
  isValidCorePattern,
  MAX_CORE_PATH_LENGTH,
  MAX_CORE_PATHS,
} from "./core-paths";

export const projectIdParam = z.object({ projectId: z.string() });

export const DEFAULT_ACTIVE_TASK_THRESHOLD = 20;
export const DEFAULT_DONE_ARCHIVE_DAYS = 30;

const corePattern = z
  .string()
  .min(1)
  .max(MAX_CORE_PATH_LENGTH)
  .refine(isValidCorePattern, {
    message:
      "Pattern must be repo-relative: no absolute path and no `..` segment",
  });

export const putSettingsBody = z.object({
  corePaths: z.array(corePattern).max(MAX_CORE_PATHS).openapi({
    description:
      'Glob patterns (picomatch, dotfiles included) matched against `refs.files` of every appended entry to fill `coreChanged`, e.g. "src/domain/**" or "**/migrations/**". Repo-relative only; a leading "./" is stripped on save. At most 50.',
  }),
  activeTaskThreshold: z.number().int().min(1).max(500).openapi({
    description:
      "Open-task count above which the overview shows a warning. Default 20.",
  }),
  doneArchiveDays: z.number().int().min(1).max(365).openapi({
    description:
      "Days a done task stays before the archive job (Phase 1c) may archive it. Stored now, not yet acted on. Default 30.",
  }),
});
