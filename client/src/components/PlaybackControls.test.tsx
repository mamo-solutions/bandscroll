// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DOCUMENT_SPEED_STEP } from "@/lib/tempo";
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
    speed: 0.0002,
    scrollVelocityPointsPerSecond: 36,
    documentGeometry: {
      revision: "test-revision",
      pageHeightsPoints: [792],
      totalHeightPoints: 792,
    },
    updatedAt: 1_000,
    connectedClients: 3,
    createdAt: 500,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 12,
    stateVersion: 1,
    ...overrides,
  };
}

function renderControls({
  session = makeSession(),
  onSetSpeed = vi.fn(),
}: {
  session?: SessionState;
  onSetSpeed?: (speed: number) => void;
}) {
  render(
    <I18nProvider>
      <PlaybackControls
        session={session}
        liveProgress={0.2}
        numPages={session.numPages}
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

  it("renders the canonical document speed", () => {
    renderControls({});

    expect(screen.getAllByText(/36 points\/sec/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/screens\/min/i)).toBeNull();
  });

  it("nudges canonical document tempo in fixed PDF-point steps", () => {
    const onSetSpeed = vi.fn();
    renderControls({ onSetSpeed });

    fireEvent.click(screen.getAllByRole("button", { name: /faster/i })[0]);

    expect(onSetSpeed).toHaveBeenCalledWith(36 + DOCUMENT_SPEED_STEP);
  });

  it("applies a fixed PDF-point preset without using viewport metrics", () => {
    const onSetSpeed = vi.fn();
    renderControls({ onSetSpeed });

    fireEvent.click(screen.getByRole("button", { name: /speed 24 points\/sec/i }));

    expect(onSetSpeed).toHaveBeenCalledWith(24);
  });

  it("disables scroll tempo controls until document geometry is ready", () => {
    renderControls({ session: makeSession({ documentGeometry: undefined }) });

    expect(screen.getByRole("button", { name: /speed 36 points\/sec/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /tap tempo/i }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getAllByText(/load the document fully/i)
        .length
    ).toBeGreaterThan(0);
  });
});
