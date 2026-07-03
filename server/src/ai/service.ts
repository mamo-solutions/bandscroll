import { decryptAiSecret, encryptAiSecret, isAiConfigEncryptionAvailable, maskAiSecret } from "./crypto.js";
import { getAiConfigStore } from "./aiConfigStore.js";
import { getAiConnector, isAiProvider } from "./connectors.js";
import { AI_PROVIDER_DEFINITIONS, getAiProviderDefinition } from "./providers.js";
import type {
  AiCapability,
  AiConfigPayload,
  AiConnectionTestResult,
  AiProvider,
  AiProviderConfig,
  AiProviderConfigSummary,
  AiResolvedProviderConfig,
} from "./types.js";

export class AiConfigError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid-provider"
      | "encryption-unavailable"
      | "api-key-required"
      | "base-url-required"
      | "base-url-unsupported"
      | "invalid-base-url"
      | "invalid-capabilities"
      | "config-not-found"
  ) {
    super(message);
    this.name = "AiConfigError";
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeCapabilities(
  provider: AiProvider,
  capabilities: AiCapability[] | undefined
): AiCapability[] {
  const supported = new Set(getAiProviderDefinition(provider)?.capabilities ?? []);
  const next = (capabilities ?? [...supported]).filter(
    (capability): capability is AiCapability => supported.has(capability)
  );
  if (next.length === 0) {
    throw new AiConfigError("Invalid capabilities.", "invalid-capabilities");
  }
  return Array.from(new Set(next));
}

function validateBaseUrl(provider: AiProvider, baseUrl?: string): string | undefined {
  const definition = getAiProviderDefinition(provider);
  const normalized = normalizeOptionalText(baseUrl);
  if (!definition?.supportsCustomBaseUrl) {
    if (normalized) {
      throw new AiConfigError("This provider does not support a custom base URL.", "base-url-unsupported");
    }
    return undefined;
  }
  if (!normalized) {
    throw new AiConfigError("A base URL is required for this provider.", "base-url-required");
  }
  try {
    const url = new URL(normalized);
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("invalid-protocol");
    }
    return normalized.replace(/\/+$/, "");
  } catch {
    throw new AiConfigError("The base URL is invalid.", "invalid-base-url");
  }
}

function summarizeConfig(
  config: AiProviderConfig,
  activeProvider: AiProvider | null
): AiProviderConfigSummary {
  return {
    provider: config.provider,
    label: getAiProviderDefinition(config.provider)?.label ?? config.provider,
    hasApiKey: true,
    maskedApiKey: maskAiSecret(decryptAiSecret(config.encryptedApiKey)),
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    capabilities: config.capabilities,
    lastTestedAt: config.lastTestedAt,
    lastTestStatus: config.lastTestStatus,
    lastError: config.lastError,
    isDefault: activeProvider === config.provider,
  };
}

export function listAiProviders() {
  return AI_PROVIDER_DEFINITIONS;
}

export function getAiConfigSummary(): {
  activeProvider: AiProvider | null;
  configs: AiProviderConfigSummary[];
} {
  if (!isAiConfigEncryptionAvailable()) {
    throw new AiConfigError("AI configuration encryption is not available.", "encryption-unavailable");
  }
  const store = getAiConfigStore();
  const activeProvider = store.getActiveProvider();
  return {
    activeProvider,
    configs: store.list().map((config) => summarizeConfig(config, activeProvider)),
  };
}

export function saveAiProviderConfig(providerParam: string, payload: AiConfigPayload): AiProviderConfigSummary {
  if (!isAiConfigEncryptionAvailable()) {
    throw new AiConfigError("AI configuration encryption is not available.", "encryption-unavailable");
  }
  if (!isAiProvider(providerParam)) {
    throw new AiConfigError("Unknown AI provider.", "invalid-provider");
  }

  const store = getAiConfigStore();
  const provider = providerParam;
  const existing = store.get(provider);
  const apiKey = normalizeOptionalText(payload.apiKey);
  if (!existing && !apiKey) {
    throw new AiConfigError("An API key is required.", "api-key-required");
  }

  const next = store.upsert({
    provider,
    encryptedApiKey: apiKey ? encryptAiSecret(apiKey) : existing!.encryptedApiKey,
    baseUrl: validateBaseUrl(provider, payload.baseUrl ?? existing?.baseUrl),
    defaultModel: normalizeOptionalText(payload.defaultModel) ?? existing?.defaultModel,
    capabilities: normalizeCapabilities(provider, payload.capabilities ?? existing?.capabilities),
    lastTestedAt: existing?.lastTestedAt,
    lastTestStatus: existing?.lastTestStatus,
    lastError: existing?.lastError,
  });

  if (payload.isDefault === true || (!store.getActiveProvider() && payload.isDefault !== false)) {
    store.setActiveProvider(provider);
  } else if (payload.isDefault === false && store.getActiveProvider() === provider) {
    store.setActiveProvider(null);
  }

  return summarizeConfig(next, store.getActiveProvider());
}

export function deleteAiProviderConfig(providerParam: string): boolean {
  if (!isAiProvider(providerParam)) {
    throw new AiConfigError("Unknown AI provider.", "invalid-provider");
  }
  return getAiConfigStore().remove(providerParam);
}

export function resolveAiProviderConfig(provider?: AiProvider): AiResolvedProviderConfig {
  if (!isAiConfigEncryptionAvailable()) {
    throw new AiConfigError("AI configuration encryption is not available.", "encryption-unavailable");
  }
  const store = getAiConfigStore();
  const resolvedProvider = provider ?? store.getActiveProvider();
  if (!resolvedProvider) {
    throw new AiConfigError("No AI provider is configured.", "config-not-found");
  }
  const config = store.get(resolvedProvider);
  if (!config) {
    throw new AiConfigError("No AI provider is configured.", "config-not-found");
  }
  return {
    provider: resolvedProvider,
    apiKey: decryptAiSecret(config.encryptedApiKey),
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    capabilities: config.capabilities,
  };
}

export async function testAiProviderConfig(providerParam: string): Promise<AiConnectionTestResult> {
  if (!isAiConfigEncryptionAvailable()) {
    throw new AiConfigError("AI configuration encryption is not available.", "encryption-unavailable");
  }
  if (!isAiProvider(providerParam)) {
    throw new AiConfigError("Unknown AI provider.", "invalid-provider");
  }

  const resolved = resolveAiProviderConfig(providerParam);
  const result = await getAiConnector(resolved.provider).validateCredential(resolved);
  getAiConfigStore().updateTestResult(resolved.provider, {
    lastTestedAt: Date.now(),
    lastTestStatus: result.ok ? "success" : "error",
    lastError: result.ok ? undefined : result.message,
  });
  return result;
}

export class AiGateway {
  resolveActiveProvider(): AiResolvedProviderConfig {
    return resolveAiProviderConfig();
  }
}

export class MarkerGenerationService {
  constructor(private readonly gateway: AiGateway = new AiGateway()) {}

  getProvider(): AiResolvedProviderConfig {
    return this.gateway.resolveActiveProvider();
  }
}

export class ChordAnalysisService {
  constructor(private readonly gateway: AiGateway = new AiGateway()) {}

  getProvider(): AiResolvedProviderConfig {
    return this.gateway.resolveActiveProvider();
  }
}
