import { describe, expect, it } from "vitest";
import {
  isAbsolutePath,
  isValidCorePattern,
  judgeCoreChanged,
  MAX_CORE_PATH_LENGTH,
  MAX_CORE_PATHS,
  normalizeRelativePath,
} from "../../../apps/api/src/agent-project/core-paths";

describe("normalizeRelativePath", () => {
  it("strips whitespace and any number of leading ./", () => {
    expect(normalizeRelativePath("src/a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("././src/a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("  src/a.ts \n")).toBe("src/a.ts");
  });

  it("returns null for absolute paths", () => {
    expect(normalizeRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeRelativePath("\\\\server\\share")).toBeNull();
    expect(normalizeRelativePath("C:\\repo\\src")).toBeNull();
    expect(normalizeRelativePath("c:/repo/src")).toBeNull();
    expect(isAbsolutePath("/x")).toBe(true);
    expect(isAbsolutePath("x/")).toBe(false);
  });

  it("returns null for any .. segment, wherever it sits", () => {
    expect(normalizeRelativePath("../src")).toBeNull();
    expect(normalizeRelativePath("src/../etc")).toBeNull();
    expect(normalizeRelativePath("src/..")).toBeNull();
    expect(normalizeRelativePath("src\\..\\etc")).toBeNull();
    // A name that merely contains dots is fine.
    expect(normalizeRelativePath("src/..hidden/a")).toBe("src/..hidden/a");
    expect(normalizeRelativePath("src/a..b.ts")).toBe("src/a..b.ts");
  });

  it("returns null for empty input, including a bare ./", () => {
    expect(normalizeRelativePath("")).toBeNull();
    expect(normalizeRelativePath("   ")).toBeNull();
    expect(normalizeRelativePath("./")).toBeNull();
  });

  it("keeps a leading dotfile", () => {
    expect(normalizeRelativePath(".github/workflows/ci.yml")).toBe(
      ".github/workflows/ci.yml",
    );
  });
});

describe("isValidCorePattern", () => {
  it("mirrors the normalizer and exposes the limits the schema uses", () => {
    expect(isValidCorePattern("src/domain/**")).toBe(true);
    expect(isValidCorePattern("**/migrations/**")).toBe(true);
    expect(isValidCorePattern("./src/**")).toBe(true);
    expect(isValidCorePattern("/src/**")).toBe(false);
    expect(isValidCorePattern("src/../**")).toBe(false);
    expect(isValidCorePattern(" ")).toBe(false);
    expect(MAX_CORE_PATHS).toBe(50);
    expect(MAX_CORE_PATH_LENGTH).toBe(200);
  });
});

describe("judgeCoreChanged", () => {
  const patterns = ["src/domain/**", "**/migrations/**"];

  it("is null when there are no files to judge, whatever the patterns", () => {
    expect(judgeCoreChanged(undefined, patterns)).toBeNull();
    expect(judgeCoreChanged(null, patterns)).toBeNull();
    expect(judgeCoreChanged(undefined, [])).toBeNull();
  });

  it("is [] (judged, nothing matched) when files exist but no pattern does", () => {
    expect(judgeCoreChanged(["src/domain/a.ts"], [])).toEqual([]);
    expect(judgeCoreChanged([], [])).toEqual([]);
    expect(judgeCoreChanged([], patterns)).toEqual([]);
  });

  it("matches nested globs at any depth and keeps input order", () => {
    expect(
      judgeCoreChanged(
        [
          "README.md",
          "apps/api/drizzle/migrations/0001_init.sql",
          "src/ui/button.tsx",
          "src/domain/order/order.ts",
          "migrations/0002.sql",
          "src/domain.ts",
        ],
        patterns,
      ),
    ).toEqual([
      "apps/api/drizzle/migrations/0001_init.sql",
      "src/domain/order/order.ts",
      "migrations/0002.sql",
    ]);
  });

  it("matches dotfiles and dot-directories under a ** pattern", () => {
    expect(
      judgeCoreChanged(
        ["src/domain/.env.example", "src/domain/.config/x.json", "src/.x"],
        ["src/domain/**"],
      ),
    ).toEqual(["src/domain/.env.example", "src/domain/.config/x.json"]);
    expect(judgeCoreChanged([".github/ci.yml"], [".github/**"])).toEqual([
      ".github/ci.yml",
    ]);
  });

  it("normalizes files before matching, skips unmatchable ones, dedupes", () => {
    expect(
      judgeCoreChanged(
        [
          "./src/domain/a.ts",
          "src/domain/a.ts",
          "/abs/src/domain/b.ts",
          "src/../src/domain/c.ts",
          " src/domain/d.ts ",
        ],
        ["src/domain/**"],
      ),
    ).toEqual(["src/domain/a.ts", "src/domain/d.ts"]);
  });

  it("supports extension globs and brace sets", () => {
    expect(
      judgeCoreChanged(
        ["a/b.sql", "a/b.ts", "x/y.prisma", "x/y.md"],
        ["**/*.sql", "**/*.{prisma,graphql}"],
      ),
    ).toEqual(["a/b.sql", "x/y.prisma"]);
  });

  it("is a pure function of its inputs", () => {
    const files = ["src/domain/a.ts"];
    const first = judgeCoreChanged(files, patterns);
    const second = judgeCoreChanged(files, patterns);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
