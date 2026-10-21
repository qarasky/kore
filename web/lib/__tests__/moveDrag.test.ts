import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { moveErrorKey } from "../moveDrag";

describe("moveErrorKey", () => {
  it("maps API errors to messages", () => {
    expect(moveErrorKey(new ApiError(409, "name_taken"))).toBe("move.error.nameTaken");
    expect(moveErrorKey(new ApiError(400, "invalid_move"))).toBe("move.error.intoItself");
    expect(moveErrorKey(new ApiError(404, "not_found"))).toBe("move.error.notFound");
    expect(moveErrorKey(new ApiError(507, "quota_exceeded"))).toBe("move.error.quota");
    expect(moveErrorKey(new Error("x"))).toBe("move.error.generic");
  });
});
