// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { MarkerSuggestionSet } from "@/types/ai";
import type { SessionState } from "@/types/session";
import { AdminSessionSetupPanel } from "./AdminSessionSetupPanel";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-1",
    code: "SESSION-1234",
    title: "Test Session",
    description: undefined,
    documentDescription: "Lead sheet image",
    pdfUrl: "/uploads/test.png",
    status: "draft",
    playing: false,
    progress: 0,
    speed: 0.0002,
    updatedAt: 1_000,
    connectedClients: 0,
    createdAt: 500,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 1,
    stateVersion: 1,
    ...overrides,
  };
}

function makeSuggestions(): MarkerSuggestionSet {
  return {
    sessionId: "session-1",
    pdfUrl: "/uploads/test.png",
    documentFingerprint: "abc",
    provider: "openai",
    model: "gpt-4.1-mini",
    status: "ready",
    suggestions: [
      {
        id: "suggestion-1",
        title: "Amazing Grace",
        page: 1,
        confidence: 0.92,
        classification: "song-start",
        reason: "Detected a new song title",
        source: "ai",
      },
    ],
    summary: {
      suggestionCount: 1,
      averageConfidence: 0.92,
      uncertainCount: 0,
    },
    createdAt: 1,
    updatedAt: 2,
    run: {
      provider: "openai",
      model: "gpt-4.1-mini",
      durationMs: 1200,
      pagesAnalyzed: 1,
      visionPagesAnalyzed: 1,
      uncertainPageCount: 0,
    },
  };
}

function renderPanel({
  session = makeSession(),
  markerSuggestionSet = makeSuggestions(),
  markerGenerationAvailable = true,
} = {}) {
  const onGenerateMarkers = vi.fn(async () => undefined);
  const onApplyMarkerSuggestions = vi.fn(async () => undefined);
  const onDiscardMarkerSuggestions = vi.fn(async () => undefined);

  render(
    <I18nProvider>
      <AdminSessionSetupPanel
        numPages={session.numPages}
        session={session}
        uploading={false}
        markerGenerationAvailable={markerGenerationAvailable}
        generatingMarkers={false}
        markerSuggestionSet={markerSuggestionSet}
        onAddMarker={vi.fn()}
        onDeleteMarker={vi.fn()}
        onGenerateMarkers={onGenerateMarkers}
        onApplyMarkerSuggestions={onApplyMarkerSuggestions}
        onDiscardMarkerSuggestions={onDiscardMarkerSuggestions}
        onOpenFilePicker={vi.fn()}
        onSeekToMarker={vi.fn()}
        onSetPlaybackMode={vi.fn()}
        onSetBackgroundMode={vi.fn()}
        onSetAutoStopAtSongEnd={vi.fn()}
        onUpdateSessionDetails={vi.fn(async () => undefined)}
        onUpdateDocumentDescription={vi.fn(async () => undefined)}
        onShortcutBindingChange={vi.fn()}
        onShortcutPresetChange={vi.fn()}
        savingSessionDetails={false}
        shortcutBindings={{
          playPausePrimary: "Space",
          playPauseSecondary: "ArrowRight",
          tapTempo: "ArrowLeft",
          speedUp: "ArrowUp",
          speedDown: "ArrowDown",
          restart: "Digit0",
          previousPage: "KeyA",
          nextPage: "KeyD",
          nextMarker: "KeyS",
          stop: "Escape",
        }}
        shortcutPreset="custom"
        savingDocumentDescription={false}
      />
    </I18nProvider>
  );

  return { onGenerateMarkers, onApplyMarkerSuggestions, onDiscardMarkerSuggestions };
}

describe("AdminSessionSetupPanel", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "en"),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows AI marker suggestions and applies edited suggestions", () => {
    const { onApplyMarkerSuggestions } = renderPanel();

    expect(screen.getByText("Create markers with AI")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Amazing Grace"), {
      target: { value: "Amazing Grace (Edited)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace current markers" }));

    expect(onApplyMarkerSuggestions).toHaveBeenCalledWith([
      expect.objectContaining({ title: "Amazing Grace (Edited)", page: 1 }),
    ]);
  });

  it("keeps marker suggestion editing stacked until large layouts", () => {
    renderPanel();

    const deleteButton = screen.getByRole("button", { name: "Delete marker" });
    expect(deleteButton.className).toContain("w-full");
    expect(deleteButton.className).toContain("lg:w-auto");
    expect(deleteButton.className).toContain("justify-start");
  });

  it("hides the AI marker card when marker generation is unavailable", () => {
    renderPanel({ markerGenerationAvailable: false, markerSuggestionSet: undefined });

    expect(screen.queryByText("Create markers with AI")).toBeNull();
  });
});
