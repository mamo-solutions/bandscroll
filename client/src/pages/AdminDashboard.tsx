import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CircleSlash,
  FileCheck2,
  FileUp,
  Link2,
  Loader2,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/api/client";
import { AdminNav } from "@/components/AdminNav";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SessionState } from "@/types/session";

export function AdminDashboard() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

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
    setBusy(true);
    setError(null);
    try {
      const session = await api.createSession({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      if (file) await api.uploadPdf(session.id, file);
      setTitle("");
      setDescription("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fehler beim Erstellen");
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
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
  }

  async function endSession(id: string) {
    await api.endSession(id);
    load();
  }

  async function deleteSession(id: string) {
    if (confirm("Session wirklich löschen? Das kann nicht rückgängig gemacht werden."))
      await api.deleteSession(id).then(load);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <AdminNav
        title="Dashboard"
        subtitle={`${sessions.length} ${sessions.length === 1 ? "Session" : "Sessions"} verwaltet`}
        showDashboard={false}
      />

      {/* Create */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5 text-primary" />
            Neue Session
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="t">
                Titel <span className="text-destructive">*</span>
              </Label>
              <Input
                id="t"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z. B. Konzert – Set 1"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="d">Beschreibung</Label>
              <Input
                id="d"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="f">PDF hochladen</Label>
              <Input
                id="f"
                ref={fileInput}
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Optional, nur PDF, max. 50 MB. Kann auch später hinzugefügt werden.
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
                {busy ? "Erstelle…" : "Session erstellen"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <h2 className="mb-4 font-heading text-xl font-semibold">Alle Sessions</h2>
      {sessions.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          Noch keine Sessions. Erstelle oben deine erste.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sessions.map((s) => (
            <Card key={s.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-heading text-lg font-semibold leading-snug">
                  {s.title}
                </h3>
                <SessionStatusBadge status={s.status} />
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
                  {s.pdfUrl ? "PDF bereit" : "Kein PDF"}
                </span>
              </div>

              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate(`/admin/session/${s.id}`)}>
                  <Settings2 />
                  Steuern
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPublicLink(s.id, s.code)}
                >
                  {copiedId === s.id ? (
                    <>
                      <Check className="text-success" />
                      Kopiert
                    </>
                  ) : (
                    <>
                      <Link2 />
                      Link
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
                    Beenden
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => deleteSession(s.id)}
                  aria-label="Session löschen"
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
