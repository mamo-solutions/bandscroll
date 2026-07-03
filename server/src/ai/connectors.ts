import { getAiProviderDefinition } from "./providers.js";
import type {
  AiConnectionTestResult,
  AiProvider,
  AiResolvedProviderConfig,
} from "./types.js";

export interface AiConnector {
  validateCredential(config: AiResolvedProviderConfig): Promise<AiConnectionTestResult>;
}

function normalizeBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

async function fetchJson(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown; message?: string }> {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      data = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      message:
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error?: unknown }).error)
          : typeof data === "string"
            ? data
            : response.statusText,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: err instanceof Error ? err.message : "Network request failed",
    };
  }
}

function success(provider: AiProvider, startedAt: number, modelCount?: number): AiConnectionTestResult {
  return {
    ok: true,
    provider,
    latencyMs: Date.now() - startedAt,
    modelCount,
  };
}

function failure(
  provider: AiProvider,
  startedAt: number,
  error: AiConnectionTestResult["error"],
  message: string
): AiConnectionTestResult {
  return {
    ok: false,
    provider,
    latencyMs: Date.now() - startedAt,
    error,
    message,
  };
}

class OpenAiCompatibleConnector implements AiConnector {
  constructor(private readonly provider: AiProvider) {}

  async validateCredential(config: AiResolvedProviderConfig): Promise<AiConnectionTestResult> {
    const startedAt = Date.now();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      return failure(config.provider, startedAt, "provider-error", "A base URL is required.");
    }

    const response = await fetchJson(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return failure(config.provider, startedAt, "invalid-api-key", "The API key was rejected.");
      }
      if (response.status === 0) {
        return failure(config.provider, startedAt, "network-error", response.message ?? "Network error");
      }
      return failure(
        config.provider,
        startedAt,
        "provider-error",
        response.message ?? "The provider returned an error."
      );
    }

    const modelCount = Array.isArray((response.data as { data?: unknown[] } | null)?.data)
      ? ((response.data as { data: unknown[] }).data.length ?? 0)
      : undefined;
    return success(config.provider, startedAt, modelCount);
  }
}

class OpenAiConnector extends OpenAiCompatibleConnector {
  constructor() {
    super("openai");
  }

  override validateCredential(config: AiResolvedProviderConfig): Promise<AiConnectionTestResult> {
    return super.validateCredential({ ...config, baseUrl: "https://api.openai.com/v1" });
  }
}

class AnthropicConnector implements AiConnector {
  async validateCredential(config: AiResolvedProviderConfig): Promise<AiConnectionTestResult> {
    const startedAt = Date.now();
    const response = await fetchJson("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return failure(config.provider, startedAt, "invalid-api-key", "The API key was rejected.");
      }
      if (response.status === 0) {
        return failure(config.provider, startedAt, "network-error", response.message ?? "Network error");
      }
      return failure(
        config.provider,
        startedAt,
        "provider-error",
        response.message ?? "The provider returned an error."
      );
    }

    const data = response.data as { data?: unknown[] } | null;
    return success(config.provider, startedAt, Array.isArray(data?.data) ? data.data.length : undefined);
  }
}

const CONNECTORS: Record<AiProvider, AiConnector> = {
  openai: new OpenAiConnector(),
  anthropic: new AnthropicConnector(),
  "openai-compatible": new OpenAiCompatibleConnector("openai-compatible"),
};

export function getAiConnector(provider: AiProvider): AiConnector {
  return CONNECTORS[provider];
}

export function isAiProvider(candidate: string): candidate is AiProvider {
  return getAiProviderDefinition(candidate) !== undefined;
}
