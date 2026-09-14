import { HTTPException } from "hono/http-exception";
import { buildKey, KEY_PATTERN, parseKey } from "./keys";

export const VERIFICATION_LAYERS = ["unit", "api", "e2e"] as const;
export type VerificationLayer = (typeof VERIFICATION_LAYERS)[number];

export type ParsedCriterion = {
  key: string;
  text: string;
  layer: VerificationLayer;
  /** The `##` section title the line sits under; null before the first section. */
  story: string | null;
  dropped: boolean;
  /** 0-based line index in the (rewritten) body */
  line: number;
};

export type ParsedRequirementDoc = {
  stories: string[];
  criteria: ParsedCriterion[];
  nextSeq: number;
  /** The body with issued keys written onto their lines — this is what gets stored. */
  body: string;
};

const STORY_RE = /^##\s+(.+?)\s*$/;
const NUMBERED_RE = /^(\s*)(\d+)\.\s+(.*?)\s*$/;
const STRIKE_RE = /^~~(.*)~~$/;
/** The badge is the LAST code span on the line; sentences may carry their own code spans. */
const BADGE_RE = /`([a-z0-9]+)`\s*$/;
const TRAILING_KEY_RE = new RegExp(
  `\\s*(${KEY_PATTERN.source.slice(1, -1)})\\s*$`,
);

/**
 * The requirement document is the source of truth (REQ-FEATURE-HUB-23): a
 * `##` heading is a story, a numbered line under it is a criterion. Rows are
 * derived from this, never edited beside it.
 *
 * A criterion line is `n. <sentence> \`unit|api|e2e\` [REQ-<FEATURE>-<n>]`.
 * A line without a key gets the next one and the key is written back so the
 * stored body carries it (REQ-FEATURE-HUB-24). `~~…~~` marks it dropped
 * (REQ-FEATURE-HUB-26). Numbered lines before the first story are prose.
 * A numbered line inside a story without a badge is a 400 (REQ-FEATURE-HUB-22):
 * silently treating it as prose would hide a criterion from spec-check.
 */
export function parseRequirementDoc(
  body: string,
  feature: string,
  nextSeq: number,
): ParsedRequirementDoc {
  const lines = body.split("\n");
  const stories: string[] = [];
  const criteria: ParsedCriterion[] = [];
  const seen = new Set<string>();
  let story: string | null = null;
  let seq = nextSeq;
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = STORY_RE.exec(raw);
    if (heading?.[1]) {
      story = heading[1];
      stories.push(story);
      continue;
    }
    if (story === null) continue;

    const numbered = NUMBERED_RE.exec(raw);
    if (!numbered) continue;
    const indent = numbered[1] ?? "";
    const number = numbered[2] ?? "";
    let content = numbered[3] ?? "";

    const strike = STRIKE_RE.exec(content);
    const dropped = Boolean(strike);
    if (strike?.[1] !== undefined) content = strike[1].trim();

    let key: string | null = null;
    const keyMatch = TRAILING_KEY_RE.exec(content);
    if (keyMatch?.[1]) {
      key = keyMatch[1];
      content = content.slice(0, keyMatch.index).trim();
    }

    const badge = BADGE_RE.exec(content);
    if (!badge) {
      throw new HTTPException(400, {
        message: `criterion without verification badge (line ${i + 1}): ${content.slice(0, 40)}`,
      });
    }
    const layer = badge[1] as VerificationLayer;
    if (!VERIFICATION_LAYERS.includes(layer)) {
      throw new HTTPException(400, {
        message: `verification badge must be one of unit | api | e2e (line ${i + 1}): ${layer}`,
      });
    }
    const text = content.slice(0, badge.index).trim();
    if (!text) {
      throw new HTTPException(400, {
        message: `criterion without text (line ${i + 1})`,
      });
    }

    if (key) {
      const parsed = parseKey(key, feature);
      seq = Math.max(seq, parsed.seq + 1);
    } else {
      key = buildKey(feature, seq);
      seq += 1;
      const rebuilt = `${text} \`${layer}\` ${key}`;
      lines[i] = `${indent}${number}. ${dropped ? `~~${rebuilt}~~` : rebuilt}`;
    }
    if (seen.has(key)) {
      throw new HTTPException(400, {
        message: `Duplicate key in document: ${key}`,
      });
    }
    seen.add(key);

    criteria.push({ key, text, layer, story, dropped, line: i });
  }

  return { stories, criteria, nextSeq: seq, body: lines.join("\n") };
}
