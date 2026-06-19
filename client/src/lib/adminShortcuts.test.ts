import { describe, expect, it } from "vitest";
import {
  assignShortcutBinding,
  deriveShortcutPreset,
  getShortcutAction,
  getShortcutPresetBindings,
} from "./adminShortcuts";

describe("admin shortcuts", () => {
  it("recognizes the built-in footswitch preset", () => {
    const bindings = getShortcutPresetBindings("footswitch");

    expect(bindings.restart).toBe("Digit0");
    expect(bindings.nextMarker).toBe("KeyS");
    expect(deriveShortcutPreset(bindings)).toBe("footswitch");
  });

  it("clears duplicate bindings when a key is reassigned", () => {
    const bindings = getShortcutPresetBindings("footswitch");
    const next = assignShortcutBinding(bindings, "tapTempo", "Space");

    expect(next.tapTempo).toBe("Space");
    expect(next.playPausePrimary).toBe("");
  });

  it("maps bound key codes to shortcut actions", () => {
    const bindings = getShortcutPresetBindings("media");

    expect(getShortcutAction("Equal", bindings)).toBe("speedUp");
    expect(getShortcutAction("KeyS", bindings)).toBe("nextMarker");
    expect(getShortcutAction("Unknown", bindings)).toBeNull();
  });
});
