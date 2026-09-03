import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  applyKeyPrefix,
  assertStorageConfigured,
  parsePositiveInt,
  resolveS3Credentials,
} from "../storage/s3";
import { buildContentDisposition, type Disposition } from "./policy";

/*
 * Fork-owned S3 access for artifacts. Configuration (endpoint, bucket,
 * credentials, key prefix, PUT TTL) is read through upstream's
 * `assertStorageConfigured()` so both surfaces point at the same bucket, but
 * the client and commands live here: upstream's helpers are shaped around task
 * images (key layout, image MIME allowlist) and this module must not edit them.
 */

const DEFAULT_DOWNLOAD_TTL_SECONDS = 60;

export class ArtifactObjectMissingError extends Error {
  constructor() {
    super("Artifact object not found in storage.");
    this.name = "ArtifactObjectMissingError";
  }
}

let clientCache: { cacheKey: string; client: S3Client } | undefined;

function getClient(config: ReturnType<typeof assertStorageConfigured>) {
  const cacheKey = JSON.stringify({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    bucket: config.bucket,
    forcePathStyle: config.forcePathStyle,
  });
  if (clientCache?.cacheKey === cacheKey) return clientCache.client;

  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Same reason as upstream: hoisted checksum params break some
    // S3-compatible providers on presigned PUTs.
    requestChecksumCalculation: "WHEN_REQUIRED",
  };
  const credentials = resolveS3Credentials(
    config.accessKeyId,
    config.secretAccessKey,
  );
  if (credentials) clientConfig.credentials = credentials;

  const client = new S3Client(clientConfig);
  clientCache = { cacheKey, client };
  return client;
}

export function getArtifactDownloadTtlSeconds() {
  return parsePositiveInt(
    process.env.AGENT_ARTIFACT_URL_TTL_SECONDS,
    DEFAULT_DOWNLOAD_TTL_SECONDS,
  );
}

/** Applies S3_KEY_PREFIX; the result is what gets stored in `storageKey`. */
export function toStorageKey(rawKey: string) {
  return applyKeyPrefix(assertStorageConfigured().keyPrefix, rawKey);
}

export async function createArtifactUploadUrl(input: {
  storageKey: string;
  contentType: string;
}): Promise<{ uploadUrl: string; expiresAt: Date }> {
  const config = assertStorageConfigured();
  const client = getClient(config);
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.storageKey,
      ContentType: input.contentType,
    }),
    {
      expiresIn: config.presignTtlSeconds,
      // The presigner signs only `host` by default; naming content-type here
      // makes the PUT carry exactly the declared type or be rejected by
      // storage, so finalize's HeadObject check is a second line, not the only.
      signableHeaders: new Set(["content-type"]),
    },
  );
  return {
    uploadUrl,
    expiresAt: new Date(Date.now() + config.presignTtlSeconds * 1000),
  };
}

/**
 * Server-side write for text artifacts (`agent_artifact_put_text`). The
 * stored `Content-Type` is the bare allowlist literal, the same value the
 * presigned path enforces, so every read path can treat the two alike.
 */
export async function putArtifactObject(input: {
  storageKey: string;
  contentType: string;
  body: string;
}): Promise<{ size: number }> {
  const config = assertStorageConfigured();
  const client = getClient(config);
  const bytes = Buffer.from(input.body, "utf8");
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.storageKey,
      Body: bytes,
      ContentType: input.contentType,
      ContentLength: bytes.length,
    }),
  );
  return { size: bytes.length };
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; Code?: unknown; code?: unknown };
  return [record.name, record.Code, record.code].some(
    (code) => code === "NotFound" || code === "NoSuchKey",
  );
}

/**
 * HeadObject. Throws `ArtifactObjectMissingError` for a missing key and
 * rethrows everything else (bucket missing, auth, network) so the caller can
 * map it to 503 rather than blame the upload.
 */
export async function headArtifactObject(
  storageKey: string,
): Promise<{ contentLength?: number; contentType?: string }> {
  const config = assertStorageConfigured();
  const client = getClient(config);
  try {
    const object = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: storageKey }),
    );
    return {
      contentLength: object.ContentLength,
      contentType: object.ContentType,
    };
  } catch (error) {
    if (isNotFound(error)) throw new ArtifactObjectMissingError();
    throw error;
  }
}

/**
 * Presigned GET with the response headers pinned. Pinning `Content-Type` to
 * the stored value (not whatever the object carries) and setting the
 * disposition server-side is what makes the sandbox-iframe rule enforceable:
 * the client never chooses how the bytes are interpreted.
 */
export async function createArtifactDownloadUrl(input: {
  storageKey: string;
  contentType: string;
  name: string;
  disposition: Disposition;
}): Promise<{ url: string; expiresAt: Date }> {
  const config = assertStorageConfigured();
  const client = getClient(config);
  const ttl = getArtifactDownloadTtlSeconds();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: input.storageKey,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: buildContentDisposition(
        input.disposition,
        input.name,
      ),
    }),
    { expiresIn: ttl },
  );
  return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
}

/** Delete is idempotent: a missing object is not an error. */
export async function deleteArtifactObject(storageKey: string): Promise<void> {
  const config = assertStorageConfigured();
  const client = getClient(config);
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }),
    );
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}
