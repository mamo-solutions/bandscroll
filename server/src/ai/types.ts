export type AiProvider = "openai" | "anthropic" | "openai-compatible";

export type AiCapability = "marker-generation" | "chord-analysis";

export type AiTestStatus = "success" | "error";

export type AiProviderConfig = {
  provider: AiProvider;
  encryptedApiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  capabilities: AiCapability[];
  lastTestedAt?: number;
  lastTestStatus?: AiTestStatus;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

export type AiProviderConfigSummary = {
  provider: AiProvider;
  label: string;
  hasApiKey: boolean;
  maskedApiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  capabilities: AiCapability[];
  lastTestedAt?: number;
  lastTestStatus?: AiTestStatus;
  lastError?: string;
  isDefault: boolean;
};

export type AiProviderDefinition = {
  id: AiProvider;
  label: string;
  description: string;
  supportsCustomBaseUrl: boolean;
  capabilities: AiCapability[];
};

export type AiConnectionTestResult = {
  ok: boolean;
  provider: AiProvider;
  latencyMs: number;
  modelCount?: number;
  error?: "missing-api-key" | "invalid-api-key" | "network-error" | "provider-error";
  message?: string;
};

export type AiConfigPayload = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  capabilities?: AiCapability[];
  isDefault?: boolean;
};

export type AiResolvedProviderConfig = {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  capabilities: AiCapability[];
};
