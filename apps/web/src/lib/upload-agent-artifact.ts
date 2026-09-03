import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import finalizeAgentArtifact, {
  type FinalizedArtifact,
} from "@/fetchers/agent-layer/finalize-agent-artifact";
import presignAgentArtifact from "@/fetchers/agent-layer/presign-agent-artifact";

/*
 * Mirrors apps/api/src/agent-artifact/policy.ts. The server is still the
 * authority; the copy here only saves a presign round trip and lets the UI
 * explain a rejection before any bytes move.
 */
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

export const ARTIFACT_CONTENT_TYPES = [
  "text/html",
  "text/markdown",
  "text/plain",
  "application/json",
  "application/pdf",
  "application/zip",
] as const;

export type ArtifactContentType = (typeof ARTIFACT_CONTENT_TYPES)[number];

/**
 * Browsers leave `File.type` empty for `.md` and report `.zip` as
 * `application/x-zip-compressed` on Windows, so the extension decides when the
 * reported type is not on the allowlist.
 */
const EXTENSION_CONTENT_TYPES: Record<string, ArtifactContentType> = {
  html: "text/html",
  htm: "text/html",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function resolveArtifactContentType(
  file: Pick<File, "name" | "type">,
): ArtifactContentType | null {
  const reported = file.type.trim().toLowerCase();
  if ((ARTIFACT_CONTENT_TYPES as readonly string[]).includes(reported)) {
    return reported as ArtifactContentType;
  }
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

export type ArtifactUploadStage = "precheck" | "presign" | "put" | "finalize";

export type ArtifactUploadReason =
  | "unsupported-type"
  | "too-large"
  | "empty"
  | "storage-unavailable"
  | "rejected"
  | "upload-failed"
  | "mismatch"
  | "forbidden"
  | "unknown";

export class ArtifactUploadError extends Error {
  stage: ArtifactUploadStage;
  reason: ArtifactUploadReason;
  status?: number;

  constructor(
    stage: ArtifactUploadStage,
    reason: ArtifactUploadReason,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "ArtifactUploadError";
    this.stage = stage;
    this.reason = reason;
    this.status = status;
  }
}

export function precheckArtifactFile(file: File): ArtifactUploadError | null {
  if (file.size <= 0) {
    return new ArtifactUploadError("precheck", "empty", "File is empty.");
  }
  if (file.size > MAX_ARTIFACT_BYTES) {
    return new ArtifactUploadError(
      "precheck",
      "too-large",
      "File exceeds 10 MiB.",
    );
  }
  if (!resolveArtifactContentType(file)) {
    return new ArtifactUploadError(
      "precheck",
      "unsupported-type",
      "File type is not allowed.",
    );
  }
  return null;
}

function mapApiError(
  stage: "presign" | "finalize",
  cause: unknown,
): ArtifactUploadError {
  if (cause instanceof AgentLayerApiError) {
    const reason: ArtifactUploadReason =
      cause.status === 503
        ? "storage-unavailable"
        : cause.status === 403
          ? "forbidden"
          : cause.status === 400
            ? stage === "finalize"
              ? "mismatch"
              : "rejected"
            : "unknown";
    return new ArtifactUploadError(stage, reason, cause.message, cause.status);
  }
  return new ArtifactUploadError(
    stage,
    "unknown",
    cause instanceof Error ? cause.message : "Request failed.",
  );
}

/**
 * XHR rather than fetch because upload progress is only observable there.
 * The headers come from presign verbatim: Content-Type is signed, so any
 * deviation is rejected by storage.
 */
export function putArtifactBytes(input: {
  uploadUrl: string;
  headers: Record<string, string>;
  file: Blob;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", input.uploadUrl);
    for (const [name, value] of Object.entries(input.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && input.onProgress) {
        input.onProgress(event.total > 0 ? event.loaded / event.total : 0);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.(1);
        resolve();
      } else {
        reject(
          new ArtifactUploadError(
            "put",
            "upload-failed",
            `Storage rejected the upload (${xhr.status}).`,
            xhr.status,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ArtifactUploadError(
          "put",
          "upload-failed",
          "Could not reach storage.",
        ),
      );
    xhr.onabort = () =>
      reject(
        new ArtifactUploadError("put", "upload-failed", "Upload cancelled."),
      );
    input.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(input.file);
  });
}

export type UploadAgentArtifactInput = {
  projectId: string;
  file: File;
  taskId?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/** presign → PUT → finalize. Throws `ArtifactUploadError` at every stage. */
export async function uploadAgentArtifact(
  input: UploadAgentArtifactInput,
): Promise<FinalizedArtifact> {
  const rejected = precheckArtifactFile(input.file);
  if (rejected) throw rejected;
  const contentType = resolveArtifactContentType(input.file);
  if (!contentType) {
    throw new ArtifactUploadError(
      "precheck",
      "unsupported-type",
      "File type is not allowed.",
    );
  }

  let presigned: Awaited<ReturnType<typeof presignAgentArtifact>>;
  try {
    presigned = await presignAgentArtifact(input.projectId, {
      name: input.file.name || "file",
      contentType,
      size: input.file.size,
      taskId: input.taskId ?? null,
    });
  } catch (cause) {
    throw mapApiError("presign", cause);
  }

  await putArtifactBytes({
    uploadUrl: presigned.uploadUrl,
    headers: presigned.headers,
    file: input.file,
    onProgress: input.onProgress,
    signal: input.signal,
  });

  try {
    return await finalizeAgentArtifact(input.projectId, {
      artifactId: presigned.artifactId,
      storageKey: presigned.storageKey,
    });
  } catch (cause) {
    throw mapApiError("finalize", cause);
  }
}
