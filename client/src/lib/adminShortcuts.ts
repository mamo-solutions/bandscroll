export type AdminShortcutAction =
  | "playPause"
  | "tapTempo"
  | "speedUp"
  | "speedDown"
  | "restart"
  | "nextMarker"
  | "stop";

export type AdminShortcutSlot =
  | "playPausePrimary"
  | "playPauseSecondary"
  | "tapTempo"
  | "speedUp"
  | "speedDown"
  | "restart"
  | "nextMarker"
  | "stop";

export type AdminShortcutPresetId = "footswitch" | "media" | "numpad" | "custom";

export type AdminShortcutBindings = Record<AdminShortcutSlot, string>;

export type ShortcutOption = {
  code: string;
  label: string;
};

const STORAGE_KEY = "bandscroll.admin-shortcuts";

export const ADMIN_SHORTCUT_SLOTS: readonly AdminShortcutSlot[] = [
  "playPausePrimary",
  "playPauseSecondary",
  "tapTempo",
  "speedUp",
  "speedDown",
  "restart",
  "nextMarker",
  "stop",
];

const EMPTY_BINDINGS: AdminShortcutBindings = {
  playPausePrimary: "",
  playPauseSecondary: "",
  tapTempo: "",
  speedUp: "",
  speedDown: "",
  restart: "",
  nextMarker: "",
  stop: "",
};

export const SHORTCUT_OPTIONS: readonly ShortcutOption[] = [
  { code: "", label: "None" },
  { code: "Space", label: "Space" },
  { code: "ArrowLeft", label: "Left Arrow" },
  { code: "ArrowRight", label: "Right Arrow" },
  { code: "ArrowUp", label: "Up Arrow" },
  { code: "ArrowDown", label: "Down Arrow" },
  { code: "KeyP", label: "P" },
  { code: "KeyT", label: "T" },
  { code: "KeyR", label: "R" },
  { code: "KeyS", label: "S" },
  { code: "Digit0", label: "0" },
  { code: "KeyJ", label: "J" },
  { code: "KeyK", label: "K" },
  { code: "KeyL", label: "L" },
  { code: "Minus", label: "-" },
  { code: "Equal", label: "+" },
  { code: "BracketLeft", label: "[" },
  { code: "BracketRight", label: "]" },
  { code: "Home", label: "Home" },
  { code: "End", label: "End" },
  { code: "Backspace", label: "Backspace" },
  { code: "Numpad0", label: "Numpad 0" },
  { code: "Numpad1", label: "Numpad 1" },
  { code: "Numpad2", label: "Numpad 2" },
  { code: "Numpad3", label: "Numpad 3" },
  { code: "Numpad7", label: "Numpad 7" },
  { code: "Numpad8", label: "Numpad 8" },
  { code: "NumpadAdd", label: "Numpad +" },
  { code: "NumpadSubtract", label: "Numpad -" },
  { code: "NumpadDecimal", label: "Numpad ." },
];

const VALID_CODES = new Set<string>(SHORTCUT_OPTIONS.map((option) => option.code));

const SLOT_TO_ACTION: Record<AdminShortcutSlot, AdminShortcutAction> = {
  playPausePrimary: "playPause",
  playPauseSecondary: "playPause",
  tapTempo: "tapTempo",
  speedUp: "speedUp",
  speedDown: "speedDown",
  restart: "restart",
  nextMarker: "nextMarker",
  stop: "stop",
};

const PRESET_BINDINGS: Record<Exclude<AdminShortcutPresetId, "custom">, AdminShortcutBindings> = {
  footswitch: {
    playPausePrimary: "Space",
    playPauseSecondary: "ArrowRight",
    tapTempo: "ArrowLeft",
    speedUp: "ArrowUp",
    speedDown: "ArrowDown",
    restart: "Digit0",
    nextMarker: "KeyS",
    stop: "",
  },
  media: {
    playPausePrimary: "Space",
    playPauseSecondary: "KeyP",
    tapTempo: "KeyT",
    speedUp: "Equal",
    speedDown: "Minus",
    restart: "Home",
    nextMarker: "KeyS",
    stop: "Backspace",
  },
  numpad: {
    playPausePrimary: "Numpad0",
    playPauseSecondary: "Numpad1",
    tapTempo: "Numpad2",
    speedUp: "NumpadAdd",
    speedDown: "NumpadSubtract",
    restart: "Numpad7",
    nextMarker: "Numpad3",
    stop: "NumpadDecimal",
  },
};

export function getShortcutPresetBindings(
  presetId: Exclude<AdminShortcutPresetId, "custom">
): AdminShortcutBindings {
  return { ...PRESET_BINDINGS[presetId] };
}

export function deriveShortcutPreset(bindings: AdminShortcutBindings): AdminShortcutPresetId {
  for (const presetId of Object.keys(PRESET_BINDINGS) as Array<Exclude<AdminShortcutPresetId, "custom">>) {
    const presetBindings = PRESET_BINDINGS[presetId];
    const matches = ADMIN_SHORTCUT_SLOTS.every((slot) => presetBindings[slot] === bindings[slot]);
    if (matches) return presetId;
  }
  return "custom";
}

export function loadShortcutBindings(): AdminShortcutBindings {
  if (typeof window === "undefined") return getShortcutPresetBindings("footswitch");
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getShortcutPresetBindings("footswitch");
    const parsed = JSON.parse(raw) as Partial<Record<AdminShortcutSlot, unknown>>;
    return normalizeShortcutBindings(parsed);
  } catch {
    return getShortcutPresetBindings("footswitch");
  }
}

export function saveShortcutBindings(bindings: AdminShortcutBindings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function assignShortcutBinding(
  bindings: AdminShortcutBindings,
  slot: AdminShortcutSlot,
  code: string
): AdminShortcutBindings {
  const next: AdminShortcutBindings = { ...bindings };

  for (const currentSlot of ADMIN_SHORTCUT_SLOTS) {
    if (currentSlot !== slot && code !== "" && next[currentSlot] === code) {
      next[currentSlot] = "";
    }
  }

  next[slot] = VALID_CODES.has(code) ? code : "";
  return next;
}

export function getShortcutAction(code: string, bindings: AdminShortcutBindings): AdminShortcutAction | null {
  for (const slot of ADMIN_SHORTCUT_SLOTS) {
    if (bindings[slot] === code) return SLOT_TO_ACTION[slot];
  }
  return null;
}

function normalizeShortcutBindings(
  input: Partial<Record<AdminShortcutSlot, unknown>>
): AdminShortcutBindings {
  const normalized: AdminShortcutBindings = { ...EMPTY_BINDINGS };

  for (const slot of ADMIN_SHORTCUT_SLOTS) {
    const value = input[slot];
    normalized[slot] = typeof value === "string" && VALID_CODES.has(value) ? value : "";
  }

  return deriveShortcutPreset(normalized) === "custom" &&
    ADMIN_SHORTCUT_SLOTS.every((slot) => normalized[slot] === "")
    ? getShortcutPresetBindings("footswitch")
    : normalized;
}
