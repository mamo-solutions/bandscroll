import { describe, expect, it } from "vitest";
import { checkPassword } from "./auth.js";

// ADMIN_PASSWORD is injected as "test-password-123" by vitest.config.ts.
describe("checkPassword", () => {
  it("accepts the configured password", () => {
    expect(checkPassword("test-password-123")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(checkPassword("wrong")).toBe(false);
    expect(checkPassword("test-password-123 ")).toBe(false); // no trimming
  });

  it("rejects non-string / empty input", () => {
    expect(checkPassword(undefined)).toBe(false);
    expect(checkPassword(null)).toBe(false);
    expect(checkPassword(123)).toBe(false);
    expect(checkPassword("")).toBe(false);
    expect(checkPassword({})).toBe(false);
  });
});
