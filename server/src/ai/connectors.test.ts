import { describe, expect, it } from "vitest";
import { extractProviderMessage } from "./connectors.js";

describe("AI connectors", () => {
  it("extracts nested provider error messages instead of stringifying objects", () => {
    expect(extractProviderMessage({ error: { message: "Bad model configuration" } })).toBe(
      "Bad model configuration"
    );
    expect(extractProviderMessage({ detail: { error: { message: "Nested failure" } } })).toBe(
      "Nested failure"
    );
  });
});
