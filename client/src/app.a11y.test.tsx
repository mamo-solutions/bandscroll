import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HeaderSlotProvider } from "@/components/HeaderSlot";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Layout } from "@/components/Layout";
import { PublicHome } from "@/pages/PublicHome";
import { AdminLogin } from "@/pages/AdminLogin";
import { AdminDashboard } from "@/pages/AdminDashboard";
import { AdminSessionControl } from "@/pages/AdminSessionControl";
import { SessionViewer } from "@/pages/SessionViewer";
import type { SessionState } from "@/types/session";

const sessionFixture: SessionState = {
  id: "session-1",
  code: "SESSION-1234",
  title: "Accessible Session",
  description: "A test session for accessibility",
  documentDescription: "Sheet music cover page with title and rehearsal markings.",
  pdfUrl: "/uploads/session.pdf",
  status: "live",
  playing: false,
  progress: 0.4,
  speed: 0.001,
  updatedAt: 1_000,
  connectedClients: 2,
  createdAt: 500,
  markers: [{ id: "marker-1", title: "Intro", page: 1 }],
  locked: false,
  playbackMode: "scroll",
  backgroundMode: "light",
  currentPage: 1,
  numPages: 4,
  stateVersion: 1,
};

const socketMock = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

const apiMock = {
  publicSessions: vi.fn<() => Promise<SessionState[]>>(),
  sessionByCode: vi.fn<(code: string) => Promise<SessionState>>(),
  adminSessions: vi.fn<() => Promise<SessionState[]>>(),
  adminSession: vi.fn<(id: string) => Promise<SessionState>>(),
  updateSessionDetails: vi.fn<(id: string, data: unknown) => Promise<SessionState>>(),
  uploadPdf: vi.fn<(id: string, file: File, documentDescription?: string) => Promise<SessionState>>(),
};

const authMock = {
  me: vi.fn<() => Promise<boolean>>(),
  logout: vi.fn<() => Promise<void>>(),
};

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "ApiError";
    }
  },
  api: {
    health: vi.fn(),
    publicSessions: (...args: []) => apiMock.publicSessions(...args),
    sessionByCode: (...args: [string]) => apiMock.sessionByCode(...args),
    adminSessions: (...args: []) => apiMock.adminSessions(...args),
    adminSession: (...args: [string]) => apiMock.adminSession(...args),
    updateSessionDetails: (...args: [string, unknown]) => apiMock.updateSessionDetails(...args),
    uploadPdf: (...args: [string, File, string | undefined]) => apiMock.uploadPdf(...args),
    startSession: vi.fn(),
    pauseSession: vi.fn(),
    seekSession: vi.fn(),
    setSpeed: vi.fn(),
    endSession: vi.fn(),
    deleteSession: vi.fn(),
    toggleSessionLock: vi.fn(),
    createSession: vi.fn(),
  },
}));

vi.mock("@/api/auth", () => ({
  auth: {
    me: (...args: []) => authMock.me(...args),
    logout: (...args: []) => authMock.logout(...args),
    login: vi.fn(),
  },
}));

vi.mock("@/sockets/socket", () => ({
  getSocket: () => socketMock,
  useSocketStatus: () => ({ state: "connected", hasEverConnected: true }),
}));

vi.mock("@/lib/useWakeLock", () => ({
  useWakeLock: () => undefined,
}));

vi.mock("@/lib/errorLog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errorLog")>("@/lib/errorLog");
  return {
    ...actual,
    reportError: vi.fn(),
  };
});

vi.mock("@/components/PdfViewer", async () => {
  const react = await import("react");

  return {
    PdfViewer: react.forwardRef(function MockPdfViewer(
      {
        regionLabel,
        describedById,
      }: {
        regionLabel?: string;
        describedById?: string;
      },
      _ref
    ) {
      return (
        <div
          role={regionLabel ? "region" : undefined}
          aria-label={regionLabel}
          aria-describedby={describedById}
        >
          Mock PDF viewer
        </div>
      );
    }),
  };
});

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => "en"),
    setItem: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  socketMock.on.mockReset();
  socketMock.off.mockReset();
  socketMock.emit.mockReset();
  apiMock.publicSessions.mockReset();
  apiMock.sessionByCode.mockReset();
  apiMock.adminSessions.mockReset();
  apiMock.adminSession.mockReset();
  apiMock.updateSessionDetails.mockReset();
  apiMock.uploadPdf.mockReset();
  authMock.me.mockReset();
  authMock.logout.mockReset();

  apiMock.publicSessions.mockResolvedValue([sessionFixture]);
  apiMock.sessionByCode.mockResolvedValue(sessionFixture);
  apiMock.adminSessions.mockResolvedValue([sessionFixture]);
  apiMock.adminSession.mockResolvedValue(sessionFixture);
  apiMock.updateSessionDetails.mockResolvedValue(sessionFixture);
  apiMock.uploadPdf.mockResolvedValue(sessionFixture);
  authMock.me.mockResolvedValue(false);
  authMock.logout.mockResolvedValue();
});

function renderWithProviders(ui: ReactNode) {
  return render(
    <I18nProvider>
      <HeaderSlotProvider>{ui}</HeaderSlotProvider>
    </I18nProvider>
  );
}

describe("route accessibility", () => {
  it("has no obvious axe violations on /", async () => {
    const view = renderWithProviders(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<PublicHome />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Open sessions" });
    expect((await axe(view.container)).violations).toEqual([]);
  });

  it("has no obvious axe violations on /admin/login", async () => {
    const view = renderWithProviders(
      <MemoryRouter initialEntries={["/admin/login"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/admin/login" element={<AdminLogin />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole("button", { name: "Sign in" });
    expect((await axe(view.container)).violations).toEqual([]);
  });

  it("has no obvious axe violations on /admin", async () => {
    const view = renderWithProviders(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Dashboard" });
    expect((await axe(view.container)).violations).toEqual([]);
  });

  it("has no obvious axe violations on /admin/session/:id", async () => {
    const view = renderWithProviders(
      <MemoryRouter initialEntries={["/admin/session/session-1"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/admin/session/:id" element={<AdminSessionControl />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Setup" });
    expect((await axe(view.container)).violations).toEqual([]);
  });

  it("has no obvious axe violations on /session/:code", async () => {
    const view = renderWithProviders(
      <MemoryRouter initialEntries={["/session/SESSION-1234"]}>
        <Routes>
          <Route path="/session/:code" element={<SessionViewer />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole("main");
    expect((await axe(view.container)).violations).toEqual([]);
  });
});
