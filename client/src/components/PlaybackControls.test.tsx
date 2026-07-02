// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { screensPerMinuteToSpeed } from "@/lib/tempo";
import type { SessionState } from "@/types/session";
import { PlaybackControls } from "./PlaybackControls";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-1",
    code: "SESSION-1234",
    title: "Test Session",
    description: undefined,
    documentDescription: undefined,
    pdfUrl: "/uploads/test.pdf",
    status: "live",
    playing: false,
    progress: 0.2,
    speed: screensPerMinuteToSpeed(7, 10),
    updatedAt: 1_000,
    connectedClients: 3,
    createdAt: 500,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    currentPage: 1,
    numPages: 12,
    stateVersion: 1,
    ...overrides,
  };
}

function renderControls({
  session = makeSession(),
  scrollableScreens = 10,
  onSetSpeed = vi.fn(),
}: {
  session?: SessionState;
  scrollableScreens?: number | null;
  onSetSpeed?: (speed: number) => void;
}) {
  render(
    <I18nProvider>
      <PlaybackControls
        session={session}
        liveProgress={0.2}
        numPages={session.numPages}
        scrollableScreens={scrollableScreens}
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        onSetSpeed={onSetSpeed}
        onSeekToCurrent={vi.fn()}
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
      />
    </I18nProvider>
  );

  return { onSetSpeed };
}

describe("PlaybackControls", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "en"),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a human-readable screens-per-minute label", () => {
    renderControls({});

    expect(screen.getAllByText(/7\.0 screens\/min/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\.011667/)).toBeNull();
  });

  it("nudges scroll tempo in 0.25 screens/min steps", () => {
    const onSetSpeed = vi.fn();
    renderControls({ onSetSpeed });

    fireEvent.click(screen.getAllByRole("button", { name: /faster/i })[0]);

    expect(onSetSpeed).toHaveBeenCalledWith(screensPerMinuteToSpeed(7.25, 10));
  });

  it("disables scroll tempo controls until metrics are ready", () => {
    renderControls({ scrollableScreens: null });

    expect(screen.getByRole("button", { name: /speed 3/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /tap tempo/i }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getAllByText(/load the document fully before the scroll tempo can be calculated/i)
        .length
    ).toBeGreaterThan(0);
  });
});
