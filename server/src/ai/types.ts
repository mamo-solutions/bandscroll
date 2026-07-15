export type AiProvider = "openai" | "anthropic" | "openai-compatible";

export type AiCapability = "marker-generation" | "chord-analysis";

export type AiTestStatus = "success" | "error";

export type AiInvocationAttachment =
  | {
      type: "text";
      name: string;
      text: string;
    }
  | {
      type: "image";
      name: string;
      mediaType: string;
      dataUrl: string;
    };

export type AiStructuredRequest = {
  model: string;
  systemPrompt: string;
  input: string;
  responseSchema: Record<string, unknown>;
  attachments?: AiInvocationAttachment[];
};

export type AiStructuredInvocationResult<T> = {
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  data?: T;
  rawText?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: "missing-api-key" | "invalid-api-key" | "network-error" | "provider-error" | "invalid-response";
  message?: string;
};

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

export type MarkerSuggestionClassification =
  | "song-start"
  | "song-continuation"
  | "front-matter"
  | "non-song"
  | "uncertain";

export type MarkerGenerationStatus = "idle" | "running" | "ready" | "error";

export type DocumentPageEvidence = {
  page: number;
  textExcerpt: string;
  textDensity: number;
  hasLargeTitleCandidate: boolean;
  repeatedHeaderFingerprint: string;
  imageAttached: boolean;
  documentDescription?: string;
  imageDataUrl?: string;
};

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

export type AdminNotificationType = "marker-generation-completed";

export type AdminNotification = {
  id: string;
  type: AdminNotificationType;
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
