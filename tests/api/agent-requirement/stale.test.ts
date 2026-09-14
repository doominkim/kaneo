import { describe, expect, it } from "vitest";
import {
  designStale,
  taskStale,
} from "../../../apps/api/src/agent-requirement/stale";

const t = (iso: string) => new Date(iso);

describe("designStale", () => {
  it("[REQ-AGENT-AUTOAPPLY-28] a requirement edited after the design's last revision makes it stale and names the key", () => {
    const verdict = designStale(t("2026-09-13T09:00:00Z"), [
      { key: "REQ-X-1", updatedAt: t("2026-09-13T08:00:00Z") },
      { key: "REQ-X-2", updatedAt: t("2026-09-13T10:00:00Z") },
    ]);
    expect(verdict.stale).toBe(true);
    expect(verdict.causes).toEqual([
      {
        kind: "requirement",
        key: "REQ-X-2",
        changedAt: t("2026-09-13T10:00:00Z"),
      },
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-28] a requirement edited exactly at revision time is not stale", () => {
    expect(
      designStale(t("2026-09-13T09:00:00Z"), [
        { key: "REQ-X-1", updatedAt: t("2026-09-13T09:00:00Z") },
      ]).stale,
    ).toBe(false);
  });

  it("[REQ-AGENT-AUTOAPPLY-29] revising the design after the requirement change clears the verdict", () => {
    const items = [{ key: "REQ-X-1", updatedAt: t("2026-09-13T10:00:00Z") }];
    expect(designStale(t("2026-09-13T09:00:00Z"), items).stale).toBe(true);
    expect(designStale(t("2026-09-13T11:00:00Z"), items)).toEqual({
      stale: false,
      causes: [],
    });
  });
});

describe("taskStale", () => {
  it("[REQ-SPEC-TABS-8] a task is stale when an upstream requirement moved after the link was made", () => {
    const verdict = taskStale([
      {
        kind: "requirement",
        key: "REQ-X-1",
        upstreamChangedAt: t("2026-09-13T10:00:00Z"),
        createdAt: t("2026-09-13T09:00:00Z"),
        acknowledgedAt: null,
      },
    ]);
    expect(verdict.stale).toBe(true);
    expect(verdict.causes[0]).toMatchObject({
      kind: "requirement",
      key: "REQ-X-1",
    });
  });

  it("[REQ-SPEC-TABS-10] acknowledging resets the clock so the same change no longer counts", () => {
    expect(
      taskStale([
        {
          kind: "requirement",
          key: "REQ-X-1",
          upstreamChangedAt: t("2026-09-13T10:00:00Z"),
          createdAt: t("2026-09-13T09:00:00Z"),
          acknowledgedAt: t("2026-09-13T11:00:00Z"),
        },
      ]).stale,
    ).toBe(false);
  });

  it("[REQ-AGENT-AUTOAPPLY-30] a design link made after the design's first revision is not stale", () => {
    expect(
      taskStale([
        {
          kind: "design",
          key: "spec-tabs",
          upstreamChangedAt: t("2026-09-13T09:00:00Z"),
          createdAt: t("2026-09-13T09:05:00Z"),
          acknowledgedAt: null,
        },
      ]),
    ).toEqual({ stale: false, causes: [] });
  });

  it("[REQ-AGENT-AUTOAPPLY-31] a design revised after the link's clock makes the task stale and names the design", () => {
    const verdict = taskStale([
      {
        kind: "design",
        key: "spec-tabs",
        upstreamChangedAt: t("2026-09-13T12:00:00Z"),
        createdAt: t("2026-09-13T09:00:00Z"),
        acknowledgedAt: t("2026-09-13T10:00:00Z"),
      },
    ]);
    expect(verdict.causes).toEqual([
      {
        kind: "design",
        key: "spec-tabs",
        changedAt: t("2026-09-13T12:00:00Z"),
      },
    ]);
  });
});
