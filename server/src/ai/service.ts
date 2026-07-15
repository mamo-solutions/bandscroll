import { randomUUID } from "node:crypto";
import { updateSessionState } from "../sessionStore.js";
import type { SessionState, SongMarker } from "../types.js";
import { logger } from "../lib/logger.js";
import { analyzeSessionDocument } from "./documentAnalysis.js";
import { decryptAiSecret, encryptAiSecret, isAiConfigEncryptionAvailable, maskAiSecret } from "./crypto.js";
import { getAiConfigStore } from "./aiConfigStore.js";
import { getAdminNotificationStore } from "./adminNotificationStore.js";
import {
  buildFallbackAttachmentText,
  getAiConnector,
  isAiProvider,
} from "./connectors.js";
import { getMarkerSuggestionStore } from "./markerSuggestionStore.js";
import { AI_PROVIDER_DEFINITIONS, getAiProviderDefinition } from "./providers.js";
import { broadcastAdminMarkerGenerationUpdated } from "../sockets/socketServer.js";
import type {
  AdminNotification,
  AiCapability,
  AiConfigPayload,
  AiConnectionTestResult,
  AiProvider,
  AiProviderConfig,
  AiProviderConfigSummary,
  AiResolvedProviderConfig,
  DocumentPageEvidence,
  MarkerGenerationSocketEvent,
  MarkerSuggestion,
  MarkerSuggestionClassification,
  MarkerSuggestionSet,
} from "./types.js";

type PageClassification = {
  page: number;
  classification: MarkerSuggestionClassification;
  title?: string;
  confidence: number;
  reason: string;
};

type ClassificationResponse = {
  pages: PageClassification[];
};

type SinglePageClassificationResponse = {
  page: PageClassification;
};

type ReconciliationResponse = {
  suggestions: Array<{
    page: number;
    title: string;
    confidence: number;
    reason: string;
  }>;
};

const MARKER_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "number" },
          classification: {
            type: "string",
            enum: ["song-start", "song-continuation", "front-matter", "non-song", "uncertain"],
          },
          title: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["page", "classification", "confidence", "reason"],
      },
    },
  },
  required: ["pages"],
} as const;

const SINGLE_PAGE_MARKER_SCHEMA = {
  type: "object",
  properties: {
    page: {
      type: "object",
      properties: {
        page: { type: "number" },
        classification: {
          type: "string",
          enum: ["song-start", "song-continuation", "front-matter", "non-song", "uncertain"],
        },
        title: { type: "string" },
        confidence: { type: "number" },
        reason: { type: "string" },
      },
      required: ["page", "classification", "confidence", "reason"],
    },
  },
  required: ["page"],
} as const;

const RECONCILIATION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "number" },
          title: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["page", "title", "confidence", "reason"],
      },
    },
  },
  required: ["suggestions"],
} as const;

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  "openai-compatible": "gpt-4o-mini",
};

const inFlightSessions = new Set<string>();
const markerLog = logger.child("ai.marker-generation");

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
      | "marker-generation-disabled"
      | "marker-generation-unavailable"
      | "marker-generation-in-progress"
      | "document-required"
      | "document-description-required"
      | "suggestions-not-found"
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

function markerGenerationAvailable(config: AiResolvedProviderConfig): boolean {
  return config.capabilities.includes("marker-generation");
}

function isImageSession(session: SessionState): boolean {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(session.pdfUrl);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function markerSummary(suggestions: MarkerSuggestion[]) {
  const count = suggestions.length;
  const averageConfidence =
    count === 0 ? 0 : suggestions.reduce((sum, suggestion) => sum + suggestion.confidence, 0) / count;
  const uncertainCount = suggestions.filter((suggestion) => suggestion.classification === "uncertain").length;
  return {
    suggestionCount: count,
    averageConfidence: Number(averageConfidence.toFixed(3)),
    uncertainCount,
  };
}

function normalizeTitle(title: string, page: number): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  return normalized || `Song ${page}`;
}

function validateAndNormalizeSuggestions(
  suggestions: Array<Partial<MarkerSuggestion>>,
  pageCount: number
): MarkerSuggestion[] {
  const seenPages = new Set<number>();
  return suggestions
    .map((suggestion) => {
      const page = Math.round(Number(suggestion.page) || 0);
      return {
        id: suggestion.id ?? randomUUID(),
        title: normalizeTitle(String(suggestion.title ?? ""), page),
        page,
        confidence: clampConfidence(Number(suggestion.confidence ?? 0.5)),
        classification: (suggestion.classification ?? "song-start") as MarkerSuggestionClassification,
        reason: String(suggestion.reason ?? "AI-generated marker"),
        source: "ai" as const,
      };
    })
    .filter((suggestion) => suggestion.page >= 1 && suggestion.page <= pageCount)
    .filter((suggestion) => {
      if (seenPages.has(suggestion.page)) return false;
      seenPages.add(suggestion.page);
      return true;
    })
    .sort((a, b) => a.page - b.page);
}

function toSongMarkers(suggestions: MarkerSuggestion[]): SongMarker[] {
  return suggestions.map((suggestion) => ({
    id: suggestion.id,
    title: suggestion.title,
    page: suggestion.page,
  }));
}

function pageInputEvidence(evidence: DocumentPageEvidence[]): string {
  return JSON.stringify(
    evidence.map((page) => ({
      page: page.page,
      textExcerpt: page.textExcerpt,
      textDensity: page.textDensity,
      hasLargeTitleCandidate: page.hasLargeTitleCandidate,
      repeatedHeaderFingerprint: page.repeatedHeaderFingerprint,
      imageAttached: page.imageAttached,
      documentDescription: page.documentDescription,
    })),
    null,
    2
  );
}

function suggestionText(suggestions: PageClassification[]): string {
  return JSON.stringify({ pages: suggestions }, null, 2);
}

function evidenceSummary(evidence: DocumentPageEvidence[]) {
  return evidence.map((page) => ({
    page: page.page,
    textDensity: page.textDensity,
    hasLargeTitleCandidate: page.hasLargeTitleCandidate,
    imageAttached: page.imageAttached,
    repeatedHeaderFingerprint: page.repeatedHeaderFingerprint || undefined,
    excerptPreview: page.textExcerpt.slice(0, 120) || undefined,
  }));
}

function classificationCounts(classifiedPages: PageClassification[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const page of classifiedPages) {
    counts[page.classification] = (counts[page.classification] ?? 0) + 1;
  }
  return counts;
}

function classificationSummary(classifiedPages: PageClassification[]) {
  return classifiedPages.map((page) => ({
    page: page.page,
    classification: page.classification,
    title: page.title?.trim() || undefined,
    confidence: Number(page.confidence.toFixed(3)),
    reason: page.reason,
  }));
}

function suggestionSummary(suggestions: MarkerSuggestion[]) {
  return suggestions.map((suggestion) => ({
    page: suggestion.page,
    title: suggestion.title,
    confidence: Number(suggestion.confidence.toFixed(3)),
    reason: suggestion.reason,
  }));
}

function isMarkerClassification(value: unknown): value is MarkerSuggestionClassification {
  return (
    value === "song-start" ||
    value === "song-continuation" ||
    value === "front-matter" ||
    value === "non-song" ||
    value === "uncertain"
  );
}

function normalizeReason(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function normalizePageClassification(
  value: Partial<PageClassification>,
  fallbackPage: number,
  fallbackReason: string
): PageClassification | null {
  const page = Math.round(Number(value.page) || fallbackPage);
  if (page < 1) return null;

  const classification = isMarkerClassification(value.classification) ? value.classification : null;
  if (!classification) return null;

  return {
    page,
    classification,
    title: normalizeOptionalText(value.title),
    confidence: clampConfidence(Number(value.confidence ?? 0.5)),
    reason: normalizeReason(value.reason, fallbackReason),
  };
}

function dedupePageClassifications(classifiedPages: PageClassification[]): PageClassification[] {
  const bestByPage = new Map<number, PageClassification>();
  for (const page of classifiedPages) {
    const existing = bestByPage.get(page.page);
    if (!existing || page.confidence >= existing.confidence) {
      bestByPage.set(page.page, page);
    }
  }
  return Array.from(bestByPage.values()).sort((left, right) => left.page - right.page);
}

function missingClassificationPages(
  evidence: DocumentPageEvidence[],
  classifiedPages: PageClassification[]
): number[] {
  const seen = new Set(classifiedPages.map((page) => page.page));
  return evidence.map((page) => page.page).filter((page) => !seen.has(page));
}

function buildBatchClassificationPrompt(evidence: DocumentPageEvidence[]): string {
  return [
    `Classify the full document and return JSON only for exactly ${evidence.length} pages.`,
    "Return one entry for every page in order with page numbers 1..N and never skip a page.",
    "If a page is ambiguous, use classification \"uncertain\" instead of omitting it.",
    "Use title only when the page starts a distinct song; otherwise omit title.",
    "Never invent page numbers outside the provided evidence.",
    pageInputEvidence(evidence),
  ].join("\n");
}

function buildSinglePageClassificationPrompt(page: DocumentPageEvidence, totalPages: number): string {
  return [
    `Classify page ${page.page} of ${totalPages} and return JSON only.`,
    "Return exactly one page object in the `page` field.",
    "Choose one classification: song-start, song-continuation, front-matter, non-song, or uncertain.",
    "Use song-start only if this page is the first page of a distinct song.",
    "If unsure, return uncertain instead of skipping the page.",
    JSON.stringify(
      {
        page: page.page,
        textExcerpt: page.textExcerpt,
        textDensity: page.textDensity,
        hasLargeTitleCandidate: page.hasLargeTitleCandidate,
        repeatedHeaderFingerprint: page.repeatedHeaderFingerprint,
        imageAttached: page.imageAttached,
        documentDescription: page.documentDescription,
      },
      null,
      2
    ),
  ].join("\n");
}

function fallbackClassification(page: DocumentPageEvidence, reason: string): PageClassification {
  return {
    page: page.page,
    classification: "uncertain",
    confidence: 0,
    reason,
  };
}

function directSuggestionsFromClassification(
  classifiedPages: PageClassification[],
  pageCount: number
): MarkerSuggestion[] {
  return validateAndNormalizeSuggestions(
    classifiedPages
      .filter((page) => page.classification === "song-start")
      .map((page) => ({
        id: randomUUID(),
        title: page.title ?? `Song ${page.page}`,
        page: page.page,
        confidence: page.confidence,
        classification: "song-start" as const,
        reason: page.reason,
      })),
    pageCount
  );
}

function buildCompletionMessage(
  sessionCode: string,
  status: "ready" | "error",
  suggestionCount: number
): string {
  if (status === "error") {
    return `AI marker generation failed for ${sessionCode}.`;
  }
  if (suggestionCount === 0) {
    return `AI marker generation finished for ${sessionCode} without suggested markers.`;
  }
  return `AI markers are ready for ${sessionCode}.`;
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

export function listAdminNotifications(): AdminNotification[] {
  return getAdminNotificationStore().listUnread();
}

export function acknowledgeAdminNotification(notificationId: string): boolean {
  return getAdminNotificationStore().acknowledge(notificationId) !== null;
}

export class AiGateway {
  resolveActiveProvider(): AiResolvedProviderConfig {
    return resolveAiProviderConfig();
  }
}

export class MarkerGenerationService {
  constructor(private readonly gateway: AiGateway = new AiGateway()) {}

  private notifyCompletion(
    session: Pick<SessionState, "id" | "code" | "title">,
    suggestionSet: MarkerSuggestionSet
  ): void {
    if (suggestionSet.status !== "ready" && suggestionSet.status !== "error") {
      return;
    }

    const notification: AdminNotification = {
      id: randomUUID(),
      type: "marker-generation-completed",
      sessionId: session.id,
      sessionCode: session.code,
      sessionTitle: session.title,
      status: suggestionSet.status,
      suggestionCount: suggestionSet.summary.suggestionCount,
      message: buildCompletionMessage(
        session.code,
        suggestionSet.status,
        suggestionSet.summary.suggestionCount
      ),
      createdAt: Date.now(),
    };
    getAdminNotificationStore().upsert(notification);

    const payload: MarkerGenerationSocketEvent = {
      notificationId: notification.id,
      sessionId: notification.sessionId,
      sessionCode: notification.sessionCode,
      sessionTitle: notification.sessionTitle,
      status: notification.status,
      suggestionCount: notification.suggestionCount,
      updatedAt: suggestionSet.updatedAt,
      error: suggestionSet.error,
    };
    broadcastAdminMarkerGenerationUpdated(payload);
  }

  private async classifyDocumentPages(
    connector: ReturnType<typeof getAiConnector>,
    providerConfig: AiResolvedProviderConfig,
    model: string,
    session: SessionState,
    evidence: DocumentPageEvidence[]
  ): Promise<PageClassification[]> {
    const classificationResult = await connector.invokeStructured<ClassificationResponse>(providerConfig, {
      model,
      systemPrompt:
        "You analyze lead sheets and songbooks. Classify every page. Song-start means the first page of one distinct song only. Covers, indexes, notes, section dividers, and continuation pages are not song starts.",
      input: buildBatchClassificationPrompt(evidence),
      responseSchema: MARKER_SCHEMA,
      attachments: [
        {
          type: "text",
          name: "page-evidence.json",
          text: pageInputEvidence(evidence),
        },
        ...evidence
          .filter((page) => page.imageAttached && page.imageDataUrl)
          .map((page) => ({
            type: "image" as const,
            name: `page-${page.page}`,
            mediaType: "image/png",
            dataUrl: page.imageDataUrl!,
          })),
      ],
    });

    if (!classificationResult.ok || !classificationResult.data) {
      markerLog.warn("classification failed", {
        sessionId: session.id,
        provider: providerConfig.provider,
        model,
        error: classificationResult.error,
        message: classificationResult.message,
        rawText: classificationResult.rawText,
        usage: classificationResult.usage,
      });
      throw new AiConfigError(
        classificationResult.message ?? "Marker generation failed.",
        "marker-generation-unavailable"
      );
    }

    const batchClassifiedPages = dedupePageClassifications(
      (classificationResult.data.pages ?? [])
        .map((page) =>
          normalizePageClassification(page, Number(page.page) || 0, "AI classified the document page.")
        )
        .filter((page): page is PageClassification => page !== null)
    );
    const batchMissingPages = missingClassificationPages(evidence, batchClassifiedPages);
    if (batchMissingPages.length === 0) {
      return batchClassifiedPages;
    }

    markerLog.warn("classification incomplete, retrying per page", {
      sessionId: session.id,
      provider: providerConfig.provider,
      model,
      classifiedPageCount: batchClassifiedPages.length,
      missingPages: batchMissingPages,
      rawText: classificationResult.rawText,
      usage: classificationResult.usage,
    });

    const perPageClassifications: PageClassification[] = [];
    for (const page of evidence) {
      const result = await connector.invokeStructured<SinglePageClassificationResponse>(providerConfig, {
        model,
        systemPrompt:
          "You analyze one page from a lead sheet or songbook. Return exactly one page classification object. If the page is ambiguous, classify it as uncertain instead of omitting it.",
        input: buildSinglePageClassificationPrompt(page, evidence.length),
        responseSchema: SINGLE_PAGE_MARKER_SCHEMA,
        attachments: [
          {
            type: "text",
            name: `page-${page.page}.json`,
            text: JSON.stringify(page, null, 2),
          },
          ...(page.imageAttached && page.imageDataUrl
            ? [
                {
                  type: "image" as const,
                  name: `page-${page.page}`,
                  mediaType: "image/png",
                  dataUrl: page.imageDataUrl,
                },
              ]
            : []),
        ],
      });

      if (!result.ok || !result.data) {
        markerLog.warn("page classification failed", {
          sessionId: session.id,
          provider: providerConfig.provider,
          model,
          page: page.page,
          error: result.error,
          message: result.message,
          rawText: result.rawText,
          usage: result.usage,
        });
        perPageClassifications.push(
          fallbackClassification(page, result.message ?? "The AI did not return a valid page classification.")
        );
        continue;
      }

      const normalized = normalizePageClassification(
        result.data.page,
        page.page,
        "AI classified the page individually."
      );
      if (!normalized) {
        markerLog.warn("page classification invalid", {
          sessionId: session.id,
          provider: providerConfig.provider,
          model,
          page: page.page,
          rawText: result.rawText,
          usage: result.usage,
        });
        perPageClassifications.push(
          fallbackClassification(page, "The AI returned an incomplete page classification.")
        );
        continue;
      }

      perPageClassifications.push(normalized.page === page.page ? normalized : { ...normalized, page: page.page });
    }

    return dedupePageClassifications(perPageClassifications);
  }

  getProvider(): AiResolvedProviderConfig {
    const provider = this.gateway.resolveActiveProvider();
    if (!markerGenerationAvailable(provider)) {
      throw new AiConfigError("The active AI provider does not support marker generation.", "marker-generation-disabled");
    }
    return provider;
  }

  getSuggestions(sessionId: string): MarkerSuggestionSet | null {
    return getMarkerSuggestionStore().get(sessionId) ?? null;
  }

  clearSuggestions(sessionId: string): boolean {
    return getMarkerSuggestionStore().remove(sessionId);
  }

  invalidateSuggestionsForSession(sessionId: string): void {
    getMarkerSuggestionStore().remove(sessionId);
  }

  private async runGeneration(
    session: SessionState,
    providerConfig: AiResolvedProviderConfig,
    model: string,
    now: number,
    existing: MarkerSuggestionSet | undefined,
    startingSet: MarkerSuggestionSet
  ): Promise<void> {
    try {
      const connector = getAiConnector(providerConfig.provider);
      const startedAt = Date.now();
      const { documentFingerprint, evidence } = await analyzeSessionDocument(session);
      markerLog.info("document analyzed", {
        sessionId: session.id,
        provider: providerConfig.provider,
        model,
        documentFingerprint,
        pageCount: evidence.length,
        visionPageCount: evidence.filter((item) => item.imageAttached).length,
        lowTextPageCount: evidence.filter((item) => item.textDensity < 80).length,
        largeTitleCandidateCount: evidence.filter((item) => item.hasLargeTitleCandidate).length,
      });
      markerLog.debug("document analysis evidence", {
        sessionId: session.id,
        evidence: evidenceSummary(evidence),
      });

      const classifiedPages = await this.classifyDocumentPages(connector, providerConfig, model, session, evidence);
      markerLog.info("classification completed", {
        sessionId: session.id,
        provider: providerConfig.provider,
        model,
        classifiedPageCount: classifiedPages.length,
        counts: classificationCounts(classifiedPages),
      });
      markerLog.debug("classification details", {
        sessionId: session.id,
        classifiedPages: classificationSummary(classifiedPages),
      });
      const reconciliationAttachments = [
        {
          type: "text" as const,
          name: "page-classification.json",
          text: suggestionText(classifiedPages),
        },
      ];

      const fallbackText = buildFallbackAttachmentText(reconciliationAttachments);
      const reconciliationResult = await connector.invokeStructured<ReconciliationResponse>(providerConfig, {
        model,
        systemPrompt:
          "You reconcile page classifications into a final set of song-start markers. Keep only real song starts, dedupe alternate titles, ignore front matter and section separators, and return pages in ascending order.",
        input:
          "Reconcile these page classifications into final song-start markers and return JSON only.\n" +
          suggestionText(classifiedPages),
        responseSchema: RECONCILIATION_SCHEMA,
        attachments: connector.supportsVision
          ? reconciliationAttachments
          : [
              {
                type: "text",
                name: "fallback.txt",
                text: fallbackText,
              },
            ],
      });

      if (!reconciliationResult.ok || !reconciliationResult.data) {
        markerLog.warn("reconciliation failed", {
          sessionId: session.id,
          provider: providerConfig.provider,
          model,
          error: reconciliationResult.error,
          message: reconciliationResult.message,
          rawText: reconciliationResult.rawText,
        });
        throw new AiConfigError(
          reconciliationResult.message ?? "Marker generation failed.",
          "marker-generation-unavailable"
        );
      }

      const pageCount = Math.max(...evidence.map((item) => item.page), 1);
      const suggestions = validateAndNormalizeSuggestions(
        (reconciliationResult.data.suggestions ?? []).map((suggestion) => ({
          id: randomUUID(),
          title: suggestion.title,
          page: suggestion.page,
          confidence: suggestion.confidence,
          classification: "song-start",
          reason: suggestion.reason,
        })),
        pageCount
      );
      const fallbackSuggestions =
        suggestions.length === 0 ? directSuggestionsFromClassification(classifiedPages, pageCount) : [];
      const normalizedSuggestions = suggestions.length > 0 ? suggestions : fallbackSuggestions;
      markerLog.info("reconciliation completed", {
        sessionId: session.id,
        provider: providerConfig.provider,
        model,
        rawSuggestionCount: reconciliationResult.data.suggestions?.length ?? 0,
        normalizedSuggestionCount: normalizedSuggestions.length,
        usedDirectClassificationFallback: suggestions.length === 0 && fallbackSuggestions.length > 0,
      });
      markerLog.debug("suggestion details", {
        sessionId: session.id,
        suggestions: suggestionSummary(normalizedSuggestions),
      });
      if (normalizedSuggestions.length === 0) {
        markerLog.warn("generation produced no suggestions", {
          sessionId: session.id,
          provider: providerConfig.provider,
          model,
          pageCount: evidence.length,
          counts: classificationCounts(classifiedPages),
          classifiedPages: classificationSummary(classifiedPages),
        });
      }

      const readySet: MarkerSuggestionSet = {
        sessionId: session.id,
        pdfUrl: session.pdfUrl,
        documentFingerprint,
        provider: providerConfig.provider,
        model,
        status: "ready",
        suggestions: normalizedSuggestions,
        summary: markerSummary(normalizedSuggestions),
        createdAt: existing?.createdAt ?? now,
        updatedAt: Date.now(),
        run: {
          provider: providerConfig.provider,
          model,
          durationMs: Date.now() - startedAt,
          pagesAnalyzed: evidence.length,
          visionPagesAnalyzed: evidence.filter((item) => item.imageAttached).length,
          uncertainPageCount: classifiedPages.filter((page) => page.classification === "uncertain").length,
        },
      };

      markerLog.info("generation completed", {
        sessionId: session.id,
        code: session.code,
        provider: readySet.provider,
        model: readySet.model,
        pageCount: readySet.run?.pagesAnalyzed,
        durationMs: readySet.run?.durationMs,
        suggestionCount: readySet.summary.suggestionCount,
        averageConfidence: readySet.summary.averageConfidence,
      });
      const persisted = getMarkerSuggestionStore().upsert(readySet);
      this.notifyCompletion(session, persisted);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Marker generation failed.";
      const failedSet: MarkerSuggestionSet = {
        ...startingSet,
        status: "error",
        updatedAt: Date.now(),
        error: errorMessage,
      };
      const persisted = getMarkerSuggestionStore().upsert(failedSet);
      markerLog.warn("generation failed", {
        sessionId: session.id,
        code: session.code,
        provider: providerConfig.provider,
        model,
        errorClass: err instanceof Error ? err.name : "UnknownError",
        errorMessage,
      });
      this.notifyCompletion(session, persisted);
    } finally {
      inFlightSessions.delete(session.id);
    }
  }

  startGeneration(session: SessionState): MarkerSuggestionSet {
    if (!session.pdfUrl) {
      throw new AiConfigError("A document must be uploaded first.", "document-required");
    }
    if (isImageSession(session) && !session.documentDescription?.trim()) {
      throw new AiConfigError("Images require a document description.", "document-description-required");
    }
    const providerConfig = this.getProvider();
    const model = providerConfig.defaultModel ?? DEFAULT_MODELS[providerConfig.provider];
    const existing = getMarkerSuggestionStore().get(session.id);
    if (inFlightSessions.has(session.id)) {
      if (existing?.status === "running") {
        return existing;
      }
      throw new AiConfigError("Marker generation is already running for this session.", "marker-generation-in-progress");
    }
    markerLog.info("generation started", {
      sessionId: session.id,
      code: session.code,
      provider: providerConfig.provider,
      model,
      pdfUrl: session.pdfUrl,
      isImageDocument: isImageSession(session),
      hasExistingMarkers: (session.markers?.length ?? 0) > 0,
    });
    const now = Date.now();
    const startingSet: MarkerSuggestionSet = {
      sessionId: session.id,
      pdfUrl: session.pdfUrl,
      documentFingerprint: existing?.documentFingerprint ?? "",
      provider: providerConfig.provider,
      model,
      status: "running",
      suggestions: existing?.suggestions ?? [],
      summary: existing?.summary ?? { suggestionCount: 0, averageConfidence: 0, uncertainCount: 0 },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const persisted = getMarkerSuggestionStore().upsert(startingSet);
    inFlightSessions.add(session.id);
    void this.runGeneration(session, providerConfig, model, now, existing, startingSet);
    return persisted;
  }

  applySuggestions(session: SessionState, suggestions?: MarkerSuggestion[]): SessionState {
    const suggestionSet = getMarkerSuggestionStore().get(session.id);
    if (!suggestionSet) {
      throw new AiConfigError("No marker suggestions are available for this session.", "suggestions-not-found");
    }
    if (suggestionSet.pdfUrl !== session.pdfUrl) {
      getMarkerSuggestionStore().remove(session.id);
      throw new AiConfigError("The document changed and the suggestions are no longer valid.", "suggestions-not-found");
    }

    const pageCount = Math.max(session.numPages, ...suggestionSet.suggestions.map((item) => item.page), 1);
    const normalizedSuggestions = validateAndNormalizeSuggestions(
      (suggestions ?? suggestionSet.suggestions).map((suggestion) => ({
        ...suggestion,
        classification: "song-start",
      })),
      pageCount
    );

    const updated = updateSessionState(session.id, { markers: toSongMarkers(normalizedSuggestions) });
    if (!updated) {
      throw new AiConfigError("No marker suggestions are available for this session.", "suggestions-not-found");
    }
    getMarkerSuggestionStore().remove(session.id);
    return updated;
  }
}

export class ChordAnalysisService {
  constructor(private readonly gateway: AiGateway = new AiGateway()) {}

  getProvider(): AiResolvedProviderConfig {
    return this.gateway.resolveActiveProvider();
  }
}
