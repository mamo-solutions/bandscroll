export type AiProvider = "openai" | "anthropic" | "openai-compatible";

export type AiCapability = "marker-generation" | "chord-analysis";

export type AiProviderDefinition = {
  id: AiProvider;
  label: string;
  description: string;
  supportsCustomBaseUrl: boolean;
  capabilities: AiCapability[];
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
  lastTestStatus?: "success" | "error";
  lastError?: string;
  isDefault: boolean;
};

export type AiConfigResponse = {
  activeProvider: AiProvider | null;
  configs: AiProviderConfigSummary[];
};

export type AiConnectionTestResult = {
  ok: boolean;
  provider: AiProvider;
  latencyMs: number;
  modelCount?: number;
  error?: "missing-api-key" | "invalid-api-key" | "network-error" | "provider-error";
  message?: string;
};
