import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, Loader2, Trash2 } from "lucide-react";
import { ApiError, api } from "@/api/client";
import { AdminNav } from "@/components/AdminNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translations";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type {
  AiCapability,
  AiConfigResponse,
  AiConnectionTestResult,
  AiProvider,
  AiProviderConfigSummary,
  AiProviderDefinition,
} from "@/types/ai";

type FormState = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  isDefault: boolean;
  capabilities: AiCapability[];
};

const EMPTY_FORM: FormState = {
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  isDefault: false,
  capabilities: [],
};

function configMap(configs: AiProviderConfigSummary[]): Map<AiProvider, AiProviderConfigSummary> {
  return new Map(configs.map((config) => [config.provider, config]));
}

export function AdminAiSettings() {
  const [providers, setProviders] = useState<AiProviderDefinition[]>([]);
  const [configState, setConfigState] = useState<AiConfigResponse>({ activeProvider: null, configs: [] });
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configUnavailable, setConfigUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const { t } = useI18n();

  useDocumentTitle(t("ai.title"));

  const configsByProvider = useMemo(() => configMap(configState.configs), [configState.configs]);
  const currentProvider = selectedProvider
    ? providers.find((provider) => provider.id === selectedProvider) ?? null
    : null;
  const currentConfig = selectedProvider ? configsByProvider.get(selectedProvider) : undefined;

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      setSelectedProvider((configState.activeProvider ?? providers[0].id) as AiProvider);
    }
  }, [providers, configState.activeProvider, selectedProvider]);

  useEffect(() => {
    if (!selectedProvider) return;
    const existing = configsByProvider.get(selectedProvider);
    setForm({
      apiKey: "",
      baseUrl: existing?.baseUrl ?? "",
      defaultModel: existing?.defaultModel ?? "",
      isDefault: configState.activeProvider === selectedProvider,
      capabilities: existing?.capabilities ?? currentProvider?.capabilities ?? [],
    });
  }, [selectedProvider, configsByProvider, configState.activeProvider, currentProvider]);

  function selectProvider(provider: AiProvider): void {
    setSelectedProvider(provider);
    setError(null);
    setTestResult(null);
  }

  async function load() {
    try {
      const nextProviders = await api.aiProviders();
      setProviders(nextProviders);

      try {
        const nextConfig = await api.aiConfig();
        setConfigState(nextConfig);
        setConfigUnavailable(false);
      } catch (err) {
        setConfigState({ activeProvider: null, configs: [] });
        if (err instanceof ApiError) {
          setConfigUnavailable(err.message === "encryption-unavailable");
          setError(errorMessage(err.message, t));
        } else {
          setConfigUnavailable(false);
          setError(t("ai.loadFailed"));
        }
      }
    } catch (err) {
      setConfigUnavailable(false);
      setError(err instanceof ApiError ? errorMessage(err.message, t) : t("ai.loadFailed"));
    }
  }

  function toggleCapability(capability: AiCapability) {
    setForm((current) => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((item) => item !== capability)
        : [...current.capabilities, capability],
    }));
  }

  async function handleSave() {
    if (!selectedProvider) return;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      await api.saveAiConfig(selectedProvider, {
        apiKey: form.apiKey.trim() || undefined,
        baseUrl: currentProvider?.supportsCustomBaseUrl ? form.baseUrl.trim() || undefined : undefined,
        defaultModel: form.defaultModel.trim() || undefined,
        capabilities: form.capabilities,
        isDefault: form.isDefault,
      });
      await load();
      setAnnouncement(t("ai.saved"));
      setForm((current) => ({ ...current, apiKey: "" }));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.message, t) : t("ai.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!selectedProvider) return;
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await api.testAiConfig(selectedProvider);
      await load();
      setTestResult(result);
      setAnnouncement(result.ok ? t("ai.testSuccess") : t("ai.testFailed"));
    } catch (err) {
      if (err instanceof ApiError) {
        const message = err.detailMessage || errorMessage(err.message, t);
        setTestResult({
          ok: false,
          provider: selectedProvider,
          latencyMs: 0,
          message,
        });
      } else {
        const message = t("ai.testFailed");
        setTestResult({
          ok: false,
          provider: selectedProvider,
          latencyMs: 0,
          message,
        });
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!selectedProvider || !currentConfig) return;
    if (!confirm(t("ai.deleteConfirm", { provider: currentProvider?.label ?? selectedProvider }))) {
      return;
    }

    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      await api.deleteAiConfig(selectedProvider);
      await load();
      setAnnouncement(t("ai.deleted"));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.message, t) : t("ai.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const controlsDisabled = configUnavailable || !selectedProvider;

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <AdminNav
        title={t("ai.title")}
        subtitle={t("ai.subtitle")}
        showDashboard
        showAiSettings={false}
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.7fr]">
        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold leading-tight">
              <Bot className="size-5 text-primary" />
              {t("ai.providers")}
            </h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {providers.map((provider) => {
              const summary = configsByProvider.get(provider.id);
              const selected = provider.id === selectedProvider;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => selectProvider(provider.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{provider.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
                    </div>
                    {summary?.isDefault && <Badge>{t("ai.defaultBadge")}</Badge>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={summary?.hasApiKey ? "default" : "outline"}>
                      {summary?.hasApiKey ? t("ai.configured") : t("ai.notConfigured")}
                    </Badge>
                    {summary?.lastTestStatus === "success" && (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                        {t("ai.testedOk")}
                      </Badge>
                    )}
                    {summary?.lastTestStatus === "error" && (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        {t("ai.testedError")}
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-semibold leading-tight">
              {currentProvider?.label ?? t("ai.selectProvider")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("ai.settingsHint")}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="provider">{t("ai.provider")}</Label>
              <Select
                id="provider"
                value={selectedProvider ?? ""}
                disabled={providers.length === 0}
                onChange={(event) => selectProvider(event.target.value as AiProvider)}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">{t("ai.apiKey")}</Label>
              <Input
                id="apiKey"
                type="password"
                value={form.apiKey}
                disabled={configUnavailable}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={currentConfig?.hasApiKey ? t("ai.keepExistingKey") : t("ai.apiKeyPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {currentConfig?.hasApiKey
                  ? t("ai.currentKey", { masked: currentConfig.maskedApiKey ?? "••••••••" })
                  : t("ai.noKeyYet")}
              </p>
            </div>

            {currentProvider?.supportsCustomBaseUrl && (
              <div className="space-y-2">
                <Label htmlFor="baseUrl">{t("ai.baseUrl")}</Label>
                <Input
                  id="baseUrl"
                  value={form.baseUrl}
                  disabled={configUnavailable}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                  placeholder="https://api.example.com/v1"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="defaultModel">{t("ai.defaultModel")}</Label>
              <Input
                id="defaultModel"
                value={form.defaultModel}
                disabled={configUnavailable}
                onChange={(event) =>
                  setForm((current) => ({ ...current, defaultModel: event.target.value }))
                }
                placeholder={t("ai.defaultModelPlaceholder")}
              />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">{t("ai.capabilities")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(currentProvider?.capabilities ?? []).map((capability) => (
                  <label
                    key={capability}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={form.capabilities.includes(capability)}
                      disabled={configUnavailable}
                      onChange={() => toggleCapability(capability)}
                    />
                    <span>{capabilityLabel(capability, t)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDefault}
                disabled={configUnavailable}
                onChange={(event) =>
                  setForm((current) => ({ ...current, isDefault: event.target.checked }))
                }
              />
              <span>{t("ai.useAsDefault")}</span>
            </label>

            {error && (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              >
                <CircleAlert className="size-4 shrink-0" />
                {error}
              </p>
            )}

            {testResult && (
              <p
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                  testResult.ok
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <CircleAlert className="size-4 shrink-0" />
                )}
                {testResult.ok
                  ? t("ai.testResultSuccess", {
                      latency: Math.round(testResult.latencyMs),
                      count: testResult.modelCount ?? 0,
                    })
                  : testResult.message ?? t("ai.testFailed")}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleSave} disabled={busy || controlsDisabled}>
                {busy ? <Loader2 className="animate-spin" /> : <Bot />}
                {busy ? t("ai.saving") : t("ai.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={testing || configUnavailable || !currentConfig?.hasApiKey}
              >
                {testing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {testing ? t("ai.testing") : t("ai.test")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={busy || configUnavailable || !currentConfig}
              >
                <Trash2 />
                {t("ai.delete")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function capabilityLabel(
  capability: AiCapability,
  t: (key: TKey, vars?: Record<string, string | number>) => string
) {
  return capability === "marker-generation" ? t("ai.capabilityMarkers") : t("ai.capabilityChords");
}

function errorMessage(
  code: string,
  t: (key: TKey, vars?: Record<string, string | number>) => string
): string {
  const lookup: Record<string, string> = {
    "encryption-unavailable": t("ai.errorEncryption"),
    "api-key-required": t("ai.errorApiKeyRequired"),
    "base-url-required": t("ai.errorBaseUrlRequired"),
    "base-url-unsupported": t("ai.errorBaseUrlUnsupported"),
    "invalid-base-url": t("ai.errorInvalidBaseUrl"),
    "invalid-capabilities": t("ai.errorCapabilities"),
    "config-not-found": t("ai.errorConfigNotFound"),
    "ai-test-rate-limit": t("ai.errorRateLimit"),
  };
  return lookup[code] ?? t("ai.loadFailed");
}
