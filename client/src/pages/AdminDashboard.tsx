import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CircleSlash,
  FileCheck2,
  FileUp,
  Link2,
  Loader2,
  Lock,
  Plus,
  Settings2,
  Trash2,
  Unlock,
} from "lucide-react";
import { api, ApiError } from "@/api/client";
import { AdminNav } from "@/components/AdminNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { SessionState } from "@/types/session";

export function AdminDashboard() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [documentDescription, setDocumentDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { t } = useI18n();
  useDocumentTitle(t("dash.title"));

  const selectedFileIsImage = !!file?.type.startsWith("image/");

  const load = () =>
    api
      .adminSessions()
      .then(setSessions)
      .catch(() => navigate("/admin/login", { replace: true }));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (selectedFileIsImage && !documentDescription.trim()) {
      setError(t("dash.documentDescriptionRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.createSession({
        title: title.trim(),
        description: description.trim() || undefined,
        documentDescription: documentDescription.trim() || undefined,
      });
      if (file) {
        await api.uploadPdf(session.id, file, documentDescription.trim() || undefined);
      }
      setTitle("");
      setDescription("");
      setDocumentDescription("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
      setAnnouncement(t("dash.sessionCreatedAnnouncement", { title: session.title }));
    } catch (err) {
      if (err instanceof ApiError && err.message === "document-description-required") {
        setError(t("dash.documentDescriptionRequired"));
      } else {
        setError(err instanceof ApiError ? err.message : t("dash.createError"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyPublicLink(id: string, code: string) {
    const url = `${window.location.origin}/session/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt("Öffentlicher Link:", url);
      return;
    }
    setCopiedId(id);
    setAnnouncement(t("dash.linkCopiedAnnouncement", { code }));
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
  }

  async function endSession(id: string) {
    await api.endSession(id);
    load();
  }

  async function deleteSession(id: string, locked: boolean) {
    if (locked) return;
    if (confirm(t("dash.deleteConfirm"))) await api.deleteSession(id).then(load);
  }

  async function toggleLock(id: string) {
    await api.toggleSessionLock(id);
    load();
  }

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <AdminNav
        title={t("dash.title")}
        subtitle={t(
          sessions.length === 1 ? "dash.subtitleOne" : "dash.subtitleOther",
          { count: sessions.length }
        )}
        showDashboard={false}
        showAiSettings
      />

      {/* Create */}
      <Card className="mb-8">
        <CardHeader>
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold leading-tight">
            <Plus className="size-5 text-primary" />
            {t("dash.newSession")}
          </h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="t">
                {t("dash.titleLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="t"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("dash.titlePlaceholder")}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="d">{t("dash.descriptionLabel")}</Label>
              <Input
                id="d"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("dash.optional")}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="f">{t("dash.uploadPdf")}</Label>
              <Input
                id="f"
                ref={fileInput}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/avif"
                onChange={(e) => {
                  const nextFile = e.target.files?.[0] ?? null;
                  setFile(nextFile);
                  if (!nextFile?.type.startsWith("image/")) return;
                  if (!documentDescription.trim()) {
                    setAnnouncement(t("dash.documentDescriptionPrompt"));
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("dash.uploadHint")}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="documentDescription">{t("dash.documentDescriptionLabel")}</Label>
              <Input
                id="documentDescription"
                value={documentDescription}
                onChange={(e) => setDocumentDescription(e.target.value)}
                placeholder={t("dash.documentDescriptionPlaceholder")}
                aria-describedby="document-description-hint"
              />
              <p id="document-description-hint" className="text-xs text-muted-foreground">
                {selectedFileIsImage
                  ? t("dash.documentDescriptionHintRequired")
                  : t("dash.documentDescriptionHint")}
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive sm:col-span-2"
              >
                <CircleSlash className="size-4 shrink-0" />
                {error}
              </p>
            )}

            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || !title.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
                {busy ? t("dash.creating") : t("dash.create")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <h2 className="mb-4 font-heading text-xl font-semibold">
        {t("dash.allSessions")}
      </h2>
      {sessions.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {t("dash.empty")}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sessions.map((s) => (
            <Card key={s.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-heading text-lg font-semibold leading-snug">
                  {s.title}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-lg bg-secondary px-2.5 py-1 font-mono font-semibold text-secondary-foreground">
                  {s.code}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    s.pdfUrl ? "text-success" : "text-muted-foreground"
                  }`}
                >
                  <FileCheck2 className="size-3.5" />
                  {s.pdfUrl ? t("dash.pdfReady") : t("dash.noPdf")}
                </span>
              </div>

              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate(`/admin/session/${s.id}`)}>
                  <Settings2 />
                  {t("dash.control")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPublicLink(s.id, s.code)}
                >
                  {copiedId === s.id ? (
                    <>
                      <Check className="text-success" />
                      {t("dash.copied")}
                    </>
                  ) : (
                    <>
                      <Link2 />
                      {t("dash.link")}
                    </>
                  )}
                </Button>
                {s.status !== "ended" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => endSession(s.id)}
                  >
                    <CircleSlash />
                    {t("dash.end")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleLock(s.id)}
                  aria-label={s.locked ? t("dash.unlockAria") : t("dash.lockAria")}
                  title={s.locked ? t("dash.unlock") : t("dash.lock")}
                >
                  {s.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "ml-auto",
                    s.locked
                      ? "text-muted-foreground"
                      : "text-destructive hover:bg-destructive/10 hover:text-destructive"
                  )}
                  onClick={() => deleteSession(s.id, s.locked)}
                  disabled={s.locked}
                  aria-label={t("dash.deleteAria")}
                >
                  <Trash2 />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
