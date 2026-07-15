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

export type MarkerSuggestionClassification =
  | "song-start"
  | "song-continuation"
  | "front-matter"
  | "non-song"
  | "uncertain";

export type MarkerGenerationStatus = "idle" | "running" | "ready" | "error";

export type MarkerSuggestion = {
  id: string;
  title: string;
  page: number;
  confidence: number;
  classification: MarkerSuggestionClassification;
  reason: string;
  source: "ai";
};

export type MarkerGenerationRunMetadata = {
  provider: AiProvider;
  model: string;
  durationMs: number;
  pagesAnalyzed: number;
  visionPagesAnalyzed: number;
  uncertainPageCount: number;
};

export type MarkerSuggestionSummary = {
  suggestionCount: number;
  averageConfidence: number;
  uncertainCount: number;
};

export type MarkerSuggestionSet = {
  sessionId: string;
  pdfUrl: string;
  documentFingerprint: string;
  provider: AiProvider;
  model: string;
  status: MarkerGenerationStatus;
  suggestions: MarkerSuggestion[];
  summary: MarkerSuggestionSummary;
  createdAt: number;
  updatedAt: number;
  error?: string;
  run?: MarkerGenerationRunMetadata;
};

export type AdminNotification = {
  id: string;
  type: "marker-generation-completed";
  sessionId: string;
  sessionCode: string;
  sessionTitle: string;
  status: "ready" | "error";
  suggestionCount: number;
  message: string;
  createdAt: number;
  acknowledgedAt?: number;
};

export type MarkerGenerationSocketEvent = {
  notificationId: string;
  sessionId: string;
  sessionCode: string;
  sessionTitle: string;
  status: "ready" | "error";
  suggestionCount: number;
  updatedAt: number;
  error?: string;
};
