import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactObjectMissingError,
  createArtifactDownloadUrl,
  createArtifactUploadUrl,
  deleteArtifactObject,
  getArtifactDownloadTtlSeconds,
  headArtifactObject,
  putArtifactObject,
  toStorageKey,
} from "../../../apps/api/src/agent-artifact/storage";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_KEY_PREFIX",
  "S3_PRESIGN_TTL_SECONDS",
  "AGENT_ARTIFACT_URL_TTL_SECONDS",
] as const;

describe("agent artifact storage", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "kaneo";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_FORCE_PATH_STYLE = "true";
    delete process.env.S3_KEY_PREFIX;
    delete process.env.S3_PRESIGN_TTL_SECONDS;
    delete process.env.AGENT_ARTIFACT_URL_TTL_SECONDS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("applies S3_KEY_PREFIX to the storage key", () => {
    expect(toStorageKey("agent-artifacts/ws/p/a/report.html")).toBe(
      "agent-artifacts/ws/p/a/report.html",
    );
    process.env.S3_KEY_PREFIX = "tenant-a/";
    expect(toStorageKey("agent-artifacts/ws/p/a/report.html")).toBe(
      "tenant-a/agent-artifacts/ws/p/a/report.html",
    );
  });

  it("throws when storage is not configured", () => {
    delete process.env.S3_BUCKET;
    expect(() => toStorageKey("x")).toThrow(/S3 uploads are not configured/);
  });

  it("signs a PUT with the content type and the upstream presign TTL", async () => {
    process.env.S3_PRESIGN_TTL_SECONDS = "120";
    const before = Date.now();
    const upload = await createArtifactUploadUrl({
      storageKey: "agent-artifacts/ws/p/a/report.html",
      contentType: "text/html",
    });
    const url = new URL(upload.uploadUrl);
    expect(url.pathname).toBe("/kaneo/agent-artifacts/ws/p/a/report.html");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-type",
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(upload.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
  });

  it("defaults the download TTL to 60s and reads the override", () => {
    expect(getArtifactDownloadTtlSeconds()).toBe(60);
    process.env.AGENT_ARTIFACT_URL_TTL_SECONDS = "30";
    expect(getArtifactDownloadTtlSeconds()).toBe(30);
    process.env.AGENT_ARTIFACT_URL_TTL_SECONDS = "nope";
    expect(getArtifactDownloadTtlSeconds()).toBe(60);
  });

  it("signs a GET with pinned content type and disposition", async () => {
    const result = await createArtifactDownloadUrl({
      storageKey: "agent-artifacts/ws/p/a/report.html",
      contentType: "text/html",
      name: "report.html",
      disposition: "inline",
    });
    const url = new URL(result.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-type")).toBe("text/html");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      `inline; filename="report.html"; filename*=UTF-8''report.html`,
    );
  });

  it("maps a missing object to ArtifactObjectMissingError and rethrows the rest", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");

    send.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { name: "NotFound" }),
    );
    await expect(headArtifactObject("k")).rejects.toBeInstanceOf(
      ArtifactObjectMissingError,
    );

    send.mockRejectedValueOnce(
      Object.assign(new Error("no bucket"), { name: "NoSuchBucket" }),
    );
    await expect(headArtifactObject("k")).rejects.toThrow("no bucket");

    send.mockResolvedValueOnce({
      ContentLength: 42,
      ContentType: "text/html",
    } as never);
    await expect(headArtifactObject("k")).resolves.toEqual({
      contentLength: 42,
      contentType: "text/html",
    });
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("writes text as UTF-8 bytes with the bare content type", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockResolvedValueOnce({} as never);

    const result = await putArtifactObject({
      storageKey: "agent-artifacts/ws/p/a/report.md",
      contentType: "text/markdown",
      body: "# 리포트\n",
    });

    expect(result).toEqual({ size: 12 });
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "kaneo",
      Key: "agent-artifacts/ws/p/a/report.md",
      ContentType: "text/markdown",
      ContentLength: 12,
    });
    expect(Buffer.from(command.input.Body as Uint8Array).toString("utf8")).toBe(
      "# 리포트\n",
    );

    send.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "AccessDenied" }),
    );
    await expect(
      putArtifactObject({
        storageKey: "k",
        contentType: "text/plain",
        body: "x",
      }),
    ).rejects.toThrow("denied");
  });

  it("ignores NotFound on delete", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { name: "NoSuchKey" }),
    );
    await expect(deleteArtifactObject("k")).resolves.toBeUndefined();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);

    send.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "AccessDenied" }),
    );
    await expect(deleteArtifactObject("k")).rejects.toThrow("denied");
  });
});
