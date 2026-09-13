import { describe, expect, it } from "vitest";
import {
  designStale,
  taskStale,
} from "../../../apps/api/src/agent-requirement/stale";

const t = (iso: string) => new Date(iso);

describe("designStale", () => {
  it("[REQ-SPEC-TABS-8] an unapproved design is not stale — it has no clock", () => {
    expect(
      designStale(null, [
        { key: "REQ-X-1", updatedAt: t("2026-09-13T10:00:00Z") },
      ]),
    ).toEqual({ stale: false, causes: [] });
  });

  it("[REQ-SPEC-TABS-8] a requirement edited after approval makes the design stale and names the key", () => {
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

  it("[REQ-SPEC-TABS-8] a requirement edited exactly at approval time is not stale", () => {
    expect(
      designStale(t("2026-09-13T09:00:00Z"), [
        { key: "REQ-X-1", updatedAt: t("2026-09-13T09:00:00Z") },
      ]).stale,
    ).toBe(false);
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

  it("[REQ-SPEC-TABS-8] a design link uses the design's approvedAt; an unapproved design never makes a task stale", () => {
    expect(
      taskStale([
        {
          kind: "design",
          key: "spec-tabs",
          upstreamChangedAt: null,
          createdAt: t("2026-09-13T09:00:00Z"),
          acknowledgedAt: null,
        },
      ]).stale,
    ).toBe(false);
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
