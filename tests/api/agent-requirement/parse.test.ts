import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { parseRequirementDoc } from "../../../apps/api/src/agent-requirement/parse";

const doc = `# Feature 허브

배경 문단. 목록도 있다:
1. 이건 산문 목록이라 기준이 아니다.

## 1. Feature 탭에서 본다

**리더로서** 한눈에 보고 싶다.

1. 시스템은 프로젝트 탭을 6개 보여준다. \`e2e\` REQ-FEATURE-HUB-1
2. Feature 탭을 열면 시스템은 feature 를 한 줄씩 보여준다. \`e2e\`
3. ~~목록을 열면 시스템은 예전 방식으로 그린다. \`api\` REQ-FEATURE-HUB-9~~

## 2. 승인

1. 설계를 처음 승인하면 시스템은 태스크를 stale 로 만들지 않는다. \`api\` REQ-FEATURE-HUB-14
`;

describe("parseRequirementDoc", () => {
  it("[REQ-FEATURE-HUB-23] reads ## sections as stories and numbered lines under them as criteria", () => {
    const parsed = parseRequirementDoc(doc, "feature-hub", 30);
    expect(parsed.stories).toEqual(["1. Feature 탭에서 본다", "2. 승인"]);
    expect(parsed.criteria.map((c) => [c.key, c.story, c.layer])).toEqual([
      ["REQ-FEATURE-HUB-1", "1. Feature 탭에서 본다", "e2e"],
      ["REQ-FEATURE-HUB-30", "1. Feature 탭에서 본다", "e2e"],
      ["REQ-FEATURE-HUB-9", "1. Feature 탭에서 본다", "api"],
      ["REQ-FEATURE-HUB-14", "2. 승인", "api"],
    ]);
    expect(parsed.criteria[0]?.text).toBe(
      "시스템은 프로젝트 탭을 6개 보여준다.",
    );
    // Prose lists before the first story are not criteria.
    expect(parsed.criteria.some((c) => c.text.includes("산문"))).toBe(false);
  });

  it("[REQ-FEATURE-HUB-24] issues the next key for a line without one and writes it back into the body", () => {
    const parsed = parseRequirementDoc(doc, "feature-hub", 30);
    expect(parsed.nextSeq).toBe(31);
    expect(parsed.body).toContain("한 줄씩 보여준다. `e2e` REQ-FEATURE-HUB-30");
    // Lines that already had a key are untouched.
    expect(parsed.body).toContain("6개 보여준다. `e2e` REQ-FEATURE-HUB-1\n");
    // Re-parsing the written body is stable: no new keys.
    const again = parseRequirementDoc(
      parsed.body,
      "feature-hub",
      parsed.nextSeq,
    );
    expect(again.body).toBe(parsed.body);
    expect(again.nextSeq).toBe(31);
  });

  it("[REQ-FEATURE-HUB-24] keeps nextSeq ahead of explicit keys imported in the body", () => {
    const parsed = parseRequirementDoc(
      "## A\n\n1. 시스템은 x. `api` REQ-FEATURE-HUB-40\n2. 시스템은 y. `api`\n",
      "feature-hub",
      3,
    );
    expect(parsed.criteria.map((c) => c.key)).toEqual([
      "REQ-FEATURE-HUB-40",
      "REQ-FEATURE-HUB-41",
    ]);
    expect(parsed.nextSeq).toBe(42);
  });

  it("[REQ-FEATURE-HUB-26] a struck-through line is a dropped criterion and keeps its key", () => {
    const parsed = parseRequirementDoc(doc, "feature-hub", 30);
    const dropped = parsed.criteria.find((c) => c.key === "REQ-FEATURE-HUB-9");
    expect(dropped?.dropped).toBe(true);
    expect(dropped?.text).toBe("목록을 열면 시스템은 예전 방식으로 그린다.");
    expect(parsed.criteria.filter((c) => c.dropped)).toHaveLength(1);
  });

  it("[REQ-FEATURE-HUB-22] rejects a criterion line without a verification badge, or with an unknown one", () => {
    expect(() =>
      parseRequirementDoc(
        "## A\n\n1. 시스템은 배지 없이 쓴다.\n",
        "feature-hub",
        1,
      ),
    ).toThrow(HTTPException);
    expect(() =>
      parseRequirementDoc(
        "## A\n\n1. 시스템은 배지 없이 쓴다.\n",
        "feature-hub",
        1,
      ),
    ).toThrow(/verification badge/);
    expect(() =>
      parseRequirementDoc("## A\n\n1. 시스템은 x. `ui`\n", "feature-hub", 1),
    ).toThrow(/unit \| api \| e2e/);
  });

  it("[REQ-FEATURE-HUB-22] a sentence may carry its own code spans; only the last one is the badge", () => {
    const parsed = parseRequirementDoc(
      "## A\n\n1. 커밋·`dev`/`main` push 는 시스템은 승인 뒤에만 한다. `e2e`\n",
      "feature-hub",
      1,
    );
    expect(parsed.criteria[0]?.layer).toBe("e2e");
    expect(parsed.criteria[0]?.text).toBe(
      "커밋·`dev`/`main` push 는 시스템은 승인 뒤에만 한다.",
    );
  });

  it("[REQ-FEATURE-HUB-23] rejects keys of another feature and duplicate keys", () => {
    expect(() =>
      parseRequirementDoc(
        "## A\n\n1. x `api` REQ-ADMIN-QA-1\n",
        "feature-hub",
        1,
      ),
    ).toThrow(/does not belong/);
    expect(() =>
      parseRequirementDoc(
        "## A\n\n1. x `api` REQ-FEATURE-HUB-1\n2. y `api` REQ-FEATURE-HUB-1\n",
        "feature-hub",
        1,
      ),
    ).toThrow(/Duplicate key/);
  });

  it("[REQ-FEATURE-HUB-23] a document with no criteria lines parses to nothing (items mode stays possible)", () => {
    const parsed = parseRequirementDoc(
      "# 제목\n\n배경만 있다.\n",
      "feature-hub",
      5,
    );
    expect(parsed.criteria).toEqual([]);
    expect(parsed.stories).toEqual([]);
    expect(parsed.nextSeq).toBe(5);
    expect(parsed.body).toBe("# 제목\n\n배경만 있다.\n");
  });
});
