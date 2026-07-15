import { describe, expect, it } from "vitest";
import { allowedConnectSources } from "./origin.js";

describe("allowedConnectSources", () => {
  it("permits Vite's development fallback port for Socket.IO", () => {
    expect(allowedConnectSources()).toContain("http://localhost:5174");
    expect(allowedConnectSources()).toContain("ws://localhost:5174");
  });
});
