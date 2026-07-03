// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { HeaderSlotProvider } from "@/components/HeaderSlot";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AdminAiSettings } from "./AdminAiSettings";

const apiMock = {
  aiProviders: vi.fn(),
  aiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  testAiConfig: vi.fn(),
  deleteAiConfig: vi.fn(),
};

const authMock = {
  logout: vi.fn(),
};

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    detailMessage?: string;

    constructor(status: number, message: string, detailMessage?: string) {
      super(message);
      this.status = status;
      this.detailMessage = detailMessage;
      this.name = "ApiError";
    }
  },
  api: {
    aiProviders: (...args: []) => apiMock.aiProviders(...args),
    aiConfig: (...args: []) => apiMock.aiConfig(...args),
    saveAiConfig: (...args: [string, unknown]) => apiMock.saveAiConfig(...args),
    testAiConfig: (...args: [string]) => apiMock.testAiConfig(...args),
    deleteAiConfig: (...args: [string]) => apiMock.deleteAiConfig(...args),
  },
}));

vi.mock("@/api/auth", () => ({
  auth: {
    logout: (...args: []) => authMock.logout(...args),
    me: vi.fn(),
    login: vi.fn(),
  },
}));

vi.stubGlobal("confirm", vi.fn(() => true));

function renderPage() {
  return render(
    <I18nProvider>
      <HeaderSlotProvider>
        <MemoryRouter>
          <AdminAiSettings />
        </MemoryRouter>
      </HeaderSlotProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => "en"),
    setItem: vi.fn(),
  });
  apiMock.aiProviders.mockReset();
  apiMock.aiConfig.mockReset();
  apiMock.saveAiConfig.mockReset();
  apiMock.testAiConfig.mockReset();
  apiMock.deleteAiConfig.mockReset();
  authMock.logout.mockReset();

  apiMock.aiProviders.mockResolvedValue([
    {
      id: "openai-compatible",
      label: "OpenAI-Compatible",
      description: "Custom provider",
      supportsCustomBaseUrl: true,
      capabilities: ["marker-generation", "chord-analysis"],
    },
  ]);
  apiMock.aiConfig.mockResolvedValue({
    activeProvider: "openai-compatible",
    configs: [
      {
        provider: "openai-compatible",
        label: "OpenAI-Compatible",
        hasApiKey: true,
        maskedApiKey: "sk…1234",
        baseUrl: "https://api.example.com/v1",
        defaultModel: "demo-model",
        capabilities: ["marker-generation"],
        isDefault: true,
      },
    ],
  });
  apiMock.saveAiConfig.mockResolvedValue({});
  apiMock.testAiConfig.mockResolvedValue({
    ok: true,
    provider: "openai-compatible",
    latencyMs: 42,
    modelCount: 3,
  });
  apiMock.deleteAiConfig.mockResolvedValue({ ok: true });
  authMock.logout.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("AdminAiSettings", () => {
  it("loads stored config and shows provider-specific fields", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "AI Settings" });
    await screen.findByDisplayValue("https://api.example.com/v1");
    expect(screen.getByDisplayValue("demo-model")).toBeTruthy();
    expect(screen.getByText("Current key: sk…1234")).toBeTruthy();
  });

  it("saves config updates", async () => {
    renderPage();

    const saveButton = (await screen.findAllByRole("button", { name: "Save settings" }))[0];
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "new-key" } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiMock.saveAiConfig).toHaveBeenCalledWith(
        "openai-compatible",
        expect.objectContaining({
          apiKey: "new-key",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "demo-model",
        })
      );
    });
  });

  it("tests and deletes config", async () => {
    renderPage();

    const testButton = (await screen.findAllByRole("button", { name: "Test connection" }))[0];
    fireEvent.click(testButton);
    await screen.findByText("Connection succeeded. Found 3 models in 42 ms.");
    expect(apiMock.testAiConfig).toHaveBeenCalledWith("openai-compatible");
    await waitFor(() => {
      expect(screen.getByText("Connection succeeded. Found 3 models in 42 ms.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete configuration" }));
    await waitFor(() => {
      expect(apiMock.deleteAiConfig).toHaveBeenCalledWith("openai-compatible");
    });
  });

  it("shows a handled admin error when config loading is unavailable", async () => {
    apiMock.aiConfig.mockRejectedValue(new ApiError(503, "encryption-unavailable"));
    renderPage();

    await screen.findByRole("heading", { name: "AI Settings" });
    await screen.findByRole("alert");
    expect(
      screen.getByText("AI configuration is currently unavailable. Check the server encryption key.")
    ).toBeTruthy();
    expect((screen.getByLabelText("API key") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows the direct backend error after a failed connection test", async () => {
    apiMock.testAiConfig.mockRejectedValue(
      new ApiError(404, "config-not-found", "No configuration has been stored for this provider yet.")
    );
    renderPage();

    const testButton = (await screen.findAllByRole("button", { name: "Test connection" }))[0];
    fireEvent.click(testButton);

    const messages = await screen.findAllByText(
      "No configuration has been stored for this provider yet."
    );
    expect(messages).toHaveLength(1);
  });
});
