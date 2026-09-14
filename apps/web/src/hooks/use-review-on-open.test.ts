import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReviewOnOpen } from "./use-review-on-open";

type Props = { itemId?: string; reviewed?: boolean; enabled?: boolean };

function setup(initialProps: Props) {
  const onReview = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(
    ({ itemId, reviewed, enabled }: Props) =>
      useReviewOnOpen({ itemId, reviewed, enabled, onReview }),
    { initialProps },
  );
  return { onReview, ...view };
}

describe("useReviewOnOpen", () => {
  it("[REQ-AGENT-AUTOAPPLY-8] reviews an unreviewed item once, however often the detail re-renders", () => {
    const { onReview, rerender, result } = setup({
      itemId: "a",
      reviewed: false,
    });
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);

    rerender({ itemId: "a", reviewed: false });
    rerender({ itemId: "a", reviewed: false });
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("[REQ-AGENT-AUTOAPPLY-8] keeps the mark for the visit after the refetch reports it reviewed", () => {
    const { onReview, rerender, result } = setup({
      itemId: "a",
      reviewed: false,
    });
    rerender({ itemId: "a", reviewed: true });
    expect(result.current).toBe(true);

    // Same item, same mounted detail: not a new opening.
    rerender({ itemId: "a", reviewed: false });
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("[REQ-AGENT-AUTOAPPLY-8] leaves reviewed, unloaded and disabled items alone, and reviews the next item opened", () => {
    const { onReview, rerender, result } = setup({});
    expect(result.current).toBe(false);

    rerender({ itemId: "a", reviewed: true });
    expect(result.current).toBe(false);

    rerender({ itemId: "b", reviewed: false, enabled: false });
    expect(onReview).not.toHaveBeenCalled();

    rerender({ itemId: "c", reviewed: false });
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("does not retry a review the API refused", async () => {
    const onReview = vi.fn().mockRejectedValue(new Error("403"));
    const { rerender } = renderHook(() =>
      useReviewOnOpen({ itemId: "a", reviewed: false, onReview }),
    );
    await Promise.resolve();
    rerender();
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
