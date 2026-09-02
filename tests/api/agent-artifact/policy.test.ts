import { describe, expect, it } from "vitest";
import {
  ALLOWED_ARTIFACT_CONTENT_TYPES,
  buildArtifactKey,
  buildContentDisposition,
  hasPathSeparator,
  normalizeArtifactContentType,
  resolveDisposition,
  sanitizeArtifactName,
} from "../../../apps/api/src/agent-artifact/policy";

describe("artifact content type allowlist", () => {
  it("accepts exactly the six allowed types, case-insensitively", () => {
    expect(ALLOWED_ARTIFACT_CONTENT_TYPES).toEqual([
      "text/html",
      "text/markdown",
      "text/plain",
      "application/json",
      "application/pdf",
      "application/zip",
    ]);
    expect(normalizeArtifactContentType("TEXT/HTML")).toBe("text/html");
    expect(normalizeArtifactContentType("  application/PDF ")).toBe(
      "application/pdf",
    );
  });

  it("rejects parameters, images and unknown types", () => {
    expect(normalizeArtifactContentType("text/html; charset=utf-8")).toBeNull();
    expect(normalizeArtifactContentType("image/png")).toBeNull();
    expect(normalizeArtifactContentType("application/octet-stream")).toBeNull();
    expect(normalizeArtifactContentType("")).toBeNull();
  });
});

describe("sanitizeArtifactName / buildArtifactKey", () => {
  it("keeps safe names intact", () => {
    expect(sanitizeArtifactName("report.html")).toBe("report.html");
    expect(sanitizeArtifactName("kpa_v2-bundle.zip")).toBe("kpa_v2-bundle.zip");
  });

  it("replaces unsafe characters and never yields a dot-leading segment", () => {
    expect(sanitizeArtifactName("세션 리포트 (final).html")).toBe(
      "final-.html",
    );
    expect(sanitizeArtifactName("..")).toBe("file");
    expect(sanitizeArtifactName("...hidden")).toBe("hidden");
    expect(sanitizeArtifactName("   ")).toBe("file");
    expect(sanitizeArtifactName("a  b\tc.md")).toBe("a-b-c.md");
  });

  it("caps the length while preserving the extension", () => {
    const long = `${"x".repeat(300)}.pdf`;
    const sanitized = sanitizeArtifactName(long);
    expect(sanitized.length).toBeLessThanOrEqual(128);
    expect(sanitized.endsWith(".pdf")).toBe(true);
  });

  it("detects both path separator styles", () => {
    expect(hasPathSeparator("a/b.html")).toBe(true);
    expect(hasPathSeparator("a\\b.html")).toBe(true);
    expect(hasPathSeparator("a-b.html")).toBe(false);
  });

  it("lays the key out as agent-artifacts/<ws>/<project>/<id>/<name>", () => {
    expect(
      buildArtifactKey({
        workspaceId: "ws1",
        projectId: "p1",
        artifactId: "art1",
        name: "My Report.html",
      }),
    ).toBe("agent-artifacts/ws1/p1/art1/My-Report.html");
  });
});

describe("resolveDisposition", () => {
  it("honours inline only for renderable types", () => {
    for (const type of [
      "text/html",
      "text/markdown",
      "text/plain",
      "application/json",
      "application/pdf",
    ] as const) {
      expect(resolveDisposition(type, "inline")).toBe("inline");
      expect(resolveDisposition(type, "attachment")).toBe("attachment");
      expect(resolveDisposition(type, undefined)).toBe("attachment");
    }
  });

  it("forces attachment for zip regardless of the request", () => {
    expect(resolveDisposition("application/zip", "inline")).toBe("attachment");
    expect(resolveDisposition("application/zip", "attachment")).toBe(
      "attachment",
    );
    expect(resolveDisposition("application/zip", undefined)).toBe("attachment");
  });
});

describe("buildContentDisposition", () => {
  it("emits an ASCII fallback plus an RFC 5987 encoded name", () => {
    expect(buildContentDisposition("inline", "report.html")).toBe(
      `inline; filename="report.html"; filename*=UTF-8''report.html`,
    );
    expect(buildContentDisposition("attachment", '리포트 "final".pdf')).toBe(
      `attachment; filename="final.pdf"; filename*=UTF-8''%EB%A6%AC%ED%8F%AC%ED%8A%B8%20%22final%22.pdf`,
    );
  });

  it("never emits an empty fallback filename", () => {
    expect(buildContentDisposition("attachment", "리포트")).toBe(
      `attachment; filename="file"; filename*=UTF-8''%EB%A6%AC%ED%8F%AC%ED%8A%B8`,
    );
  });
});
