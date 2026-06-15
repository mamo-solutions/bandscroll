import type { SessionState } from "../types/session";

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
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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
  createSession: (data: { title: string; description?: string }) =>
    request<SessionState>("/api/admin/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  uploadPdf: (id: string, file: File) => {
    const form = new FormData();
    form.append("pdf", file);
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
};
