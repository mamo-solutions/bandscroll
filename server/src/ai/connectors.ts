import { getAiProviderDefinition } from "./providers.js";
import type {
  AiConnectionTestResult,
  AiInvocationAttachment,
  AiProvider,
  AiResolvedProviderConfig,
  AiStructuredInvocationResult,
  AiStructuredRequest,
} from "./types.js";

export interface AiConnector {
  readonly supportsVision: boolean;
  readonly supportsJsonMode: boolean;
  validateCredential(config: AiResolvedProviderConfig): Promise<AiConnectionTestResult>;
  invokeStructured<T>(
    config: AiResolvedProviderConfig,
    request: AiStructuredRequest
  ): Promise<AiStructuredInvocationResult<T>>;
}

type FetchJsonResult = { ok: boolean; status: number; data: unknown; message?: string };

const connectorOverrides = new Map<AiProvider, AiConnector>();

function normalizeBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchJsonResult> {
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
      message: extractProviderMessage(data) ?? response.statusText,
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

export function extractProviderMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const objectValue = value as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "title"]) {
    const nested = extractProviderMessage(objectValue[key]);
    if (nested) return nested;
  }

  for (const nestedValue of Object.values(objectValue)) {
    const nested = extractProviderMessage(nestedValue);
    if (nested) return nested;
  }

  return undefined;
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

function invocationFailure<T>(
  provider: AiProvider,
  model: string,
  startedAt: number,
  error: AiStructuredInvocationResult<T>["error"],
  message: string,
  rawText?: string
): AiStructuredInvocationResult<T> {
  return {
    ok: false,
    provider,
    model,
    latencyMs: Date.now() - startedAt,
    error,
    message,
    rawText,
  };
}

function parseJsonObject<T>(provider: AiProvider, model: string, startedAt: number, rawText: string) {
  try {
    return {
      ok: true as const,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      rawText,
      data: JSON.parse(rawText) as T,
    };
  } catch {
    return invocationFailure<T>(provider, model, startedAt, "invalid-response", "The AI response was not valid JSON.", rawText);
  }
}

function attachmentText(attachments: AiInvocationAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  return attachments
    .map((attachment) =>
      attachment.type === "text"
        ? `Attachment "${attachment.name}":\n${attachment.text}`
        : `Attachment "${attachment.name}": image supplied separately.`
    )
    .join("\n\n");
}

class OpenAiCompatibleConnector implements AiConnector {
  readonly supportsVision = true;
  readonly supportsJsonMode = true;

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

  async invokeStructured<T>(
    config: AiResolvedProviderConfig,
    request: AiStructuredRequest
  ): Promise<AiStructuredInvocationResult<T>> {
    const startedAt = Date.now();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      return invocationFailure(config.provider, request.model, startedAt, "provider-error", "A base URL is required.");
    }

    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `${request.input}\n\nReturn only JSON matching this schema:\n${JSON.stringify(request.responseSchema)}`,
      },
    ];
    for (const attachment of request.attachments ?? []) {
      if (attachment.type === "text") {
        content.push({ type: "text", text: `Attachment "${attachment.name}":\n${attachment.text}` });
        continue;
      }
      content.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl },
      });
    }

    const response = await fetchJson(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return invocationFailure(config.provider, request.model, startedAt, "invalid-api-key", "The API key was rejected.");
      }
      if (response.status === 0) {
        return invocationFailure(config.provider, request.model, startedAt, "network-error", response.message ?? "Network error");
      }
      return invocationFailure(
        config.provider,
        request.model,
        startedAt,
        "provider-error",
        response.message ?? "The provider returned an error."
      );
    }

    const text =
      (response.data as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> } | null)
        ?.choices?.[0]?.message?.content;
    const rawText =
      typeof text === "string"
        ? text
        : Array.isArray(text)
          ? text.map((part) => part.text ?? "").join("")
          : "";

    const parsed = parseJsonObject<T>(config.provider, request.model, startedAt, rawText);
    if (!parsed.ok) return parsed;

    const usage = (response.data as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    return {
      ...parsed,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
          }
        : undefined,
    };
  }
}

class OpenAiConnector extends OpenAiCompatibleConnector {
  constructor() {
    super("openai");
  }

  override validateCredential(config: AiResolvedProviderConfig): Promise<AiConnectionTestResult> {
    return super.validateCredential({ ...config, baseUrl: "https://api.openai.com/v1" });
  }

  override invokeStructured<T>(
    config: AiResolvedProviderConfig,
    request: AiStructuredRequest
  ): Promise<AiStructuredInvocationResult<T>> {
    return super.invokeStructured({ ...config, baseUrl: "https://api.openai.com/v1" }, request);
  }
}

class AnthropicConnector implements AiConnector {
  readonly supportsVision = true;
  readonly supportsJsonMode = false;

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

  async invokeStructured<T>(
    config: AiResolvedProviderConfig,
    request: AiStructuredRequest
  ): Promise<AiStructuredInvocationResult<T>> {
    const startedAt = Date.now();
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `${request.input}\n\nReturn only JSON matching this schema:\n${JSON.stringify(request.responseSchema)}`,
      },
    ];

    for (const attachment of request.attachments ?? []) {
      if (attachment.type === "text") {
        content.push({ type: "text", text: `Attachment "${attachment.name}":\n${attachment.text}` });
        continue;
      }

      const [prefix, base64] = attachment.dataUrl.split(",", 2);
      const mediaType = prefix.match(/data:(.*);base64/)?.[1] ?? attachment.mediaType;
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64,
        },
      });
    }

    const response = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 4096,
        system: request.systemPrompt,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return invocationFailure(config.provider, request.model, startedAt, "invalid-api-key", "The API key was rejected.");
      }
      if (response.status === 0) {
        return invocationFailure(config.provider, request.model, startedAt, "network-error", response.message ?? "Network error");
      }
      return invocationFailure(
        config.provider,
        request.model,
        startedAt,
        "provider-error",
        response.message ?? "The provider returned an error."
      );
    }

    const rawText = (
      (response.data as { content?: Array<{ type?: string; text?: string }> } | null)?.content ?? []
    )
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n");
    const parsed = parseJsonObject<T>(config.provider, request.model, startedAt, rawText);
    if (!parsed.ok) return parsed;

    const usage = (response.data as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
    return {
      ...parsed,
      usage: usage
        ? {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
          }
        : undefined,
    };
  }
}

class TestConnector implements AiConnector {
  readonly supportsVision = false;
  readonly supportsJsonMode = true;

  constructor(private readonly provider: AiProvider) {}

  async validateCredential(): Promise<AiConnectionTestResult> {
    return {
      ok: true,
      provider: this.provider,
      latencyMs: 1,
      modelCount: 1,
    };
  }

  async invokeStructured<T>(
    _config: AiResolvedProviderConfig,
    request: AiStructuredRequest
  ): Promise<AiStructuredInvocationResult<T>> {
    return invocationFailure(this.provider, request.model, Date.now(), "provider-error", "No test connector override has been configured.");
  }
}

const CONNECTORS: Record<AiProvider, AiConnector> = {
  openai: new OpenAiConnector(),
  anthropic: new AnthropicConnector(),
  "openai-compatible": new OpenAiCompatibleConnector("openai-compatible"),
};

export function getAiConnector(provider: AiProvider): AiConnector {
  return connectorOverrides.get(provider) ?? CONNECTORS[provider];
}

export function isAiProvider(candidate: string): candidate is AiProvider {
  return getAiProviderDefinition(candidate) !== undefined;
}

export function setAiConnectorOverride(provider: AiProvider, connector: AiConnector | null): void {
  if (connector) {
    connectorOverrides.set(provider, connector);
    return;
  }
  connectorOverrides.delete(provider);
}

export function resetAiConnectorOverrides(): void {
  connectorOverrides.clear();
}

export function createTestAiConnector(provider: AiProvider): AiConnector {
  return new TestConnector(provider);
}

export function inferVisionSupport(attachments: AiInvocationAttachment[] | undefined): boolean {
  return Boolean(attachments?.some((attachment) => attachment.type === "image"));
}

export function buildFallbackAttachmentText(attachments: AiInvocationAttachment[] | undefined): string {
  return attachmentText(attachments);
}
