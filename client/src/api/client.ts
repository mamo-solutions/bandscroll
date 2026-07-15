import type { SessionState } from "../types/session";
import type {
  AiConfigResponse,
  AiConnectionTestResult,
  AiProvider,
  AiProviderDefinition,
  AiProviderConfigSummary,
  AdminNotification,
  MarkerGenerationSocketEvent,
  MarkerSuggestion,
  MarkerSuggestionSet,
} from "../types/ai";

// Same-origin requests; credentials:include carries the admin session cookie.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
        : init?.headers,
    ...init,
  });
  if (!res.ok) {
    let detail = "";
    let message = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? "";
      message = body.message ?? "";
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail || res.statusText, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detailMessage?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- Public ----
export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  publicSessions: () => request<SessionState[]>("/api/sessions/public"),
  sessionByCode: (code: string) =>
    request<SessionState>(`/api/sessions/code/${encodeURIComponent(code)}`),

  // ---- Admin ----
  adminSessions: () => request<SessionState[]>("/api/admin/sessions"),
  adminSession: (id: string) =>
    request<SessionState>(`/api/admin/sessions/${id}`),
  createSession: (data: {
    title: string;
    description?: string;
    documentDescription?: string;
  }) =>
    request<SessionState>("/api/admin/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSessionDetails: (
    id: string,
    data: { title?: string; description?: string; documentDescription?: string }
  ) =>
    request<SessionState>(`/api/admin/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  uploadPdf: (id: string, file: File, documentDescription?: string) => {
    const form = new FormData();
    form.append("pdf", file);
    if (documentDescription !== undefined) {
      form.append("documentDescription", documentDescription);
    }
    return request<SessionState>(`/api/admin/sessions/${id}/pdf`, {
      method: "POST",
      body: form,
    });
  },
  startSession: (id: string) =>
    request<SessionState>(`/api/admin/sessions/${id}/start`, { method: "POST" }),
  pauseSession: (id: string) =>
    request<SessionState>(`/api/admin/sessions/${id}/pause`, { method: "POST" }),
  seekSession: (id: string, progress: number) =>
    request<SessionState>(`/api/admin/sessions/${id}/seek`, {
      method: "POST",
      body: JSON.stringify({ progress }),
    }),
  setSpeed: (id: string, speed: number) =>
    request<SessionState>(`/api/admin/sessions/${id}/speed`, {
      method: "POST",
      body: JSON.stringify({ speed }),
    }),
  endSession: (id: string) =>
    request<SessionState>(`/api/admin/sessions/${id}/end`, { method: "POST" }),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/sessions/${id}`, { method: "DELETE" }),
  toggleSessionLock: (id: string) =>
    request<SessionState>(`/api/admin/sessions/${id}/toggle-lock`, {
      method: "POST",
    }),
  aiProviders: () => request<AiProviderDefinition[]>("/api/admin/ai/providers"),
  aiConfig: () => request<AiConfigResponse>("/api/admin/ai/config"),
  saveAiConfig: (
    provider: AiProvider,
    data: {
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string;
      capabilities?: string[];
      isDefault?: boolean;
    }
  ) =>
    request<AiProviderConfigSummary>(`/api/admin/ai/config/${provider}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  testAiConfig: (provider: AiProvider) =>
    request<AiConnectionTestResult>(`/api/admin/ai/config/${provider}/test`, {
      method: "POST",
    }),
  deleteAiConfig: (provider: AiProvider) =>
    request<{ ok: boolean }>(`/api/admin/ai/config/${provider}`, {
      method: "DELETE",
    }),
  markerSuggestions: (id: string) =>
    request<MarkerSuggestionSet>(`/api/admin/sessions/${id}/markers/suggestions`),
  generateMarkers: (id: string) =>
    request<MarkerSuggestionSet>(`/api/admin/sessions/${id}/markers/generate`, {
      method: "POST",
    }),
  adminNotifications: () =>
    request<AdminNotification[]>("/api/admin/notifications"),
  ackAdminNotification: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/notifications/${id}/ack`, {
      method: "POST",
    }),
  applyMarkerSuggestions: (id: string, suggestions: MarkerSuggestion[]) =>
    request<SessionState>(`/api/admin/sessions/${id}/markers/apply-suggestions`, {
      method: "POST",
      body: JSON.stringify({ suggestions }),
    }),
  deleteMarkerSuggestions: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/sessions/${id}/markers/suggestions`, {
      method: "DELETE",
    }),
};

export type { MarkerGenerationSocketEvent };
