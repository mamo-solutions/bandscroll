import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound } from "lucide-react";
import { api } from "@/api/client";
import { getSocket } from "@/sockets/socket";
import { PublicSessionList } from "@/components/PublicSessionList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/I18nProvider";
import type { SessionState } from "@/types/session";

export function PublicHome() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const { t } = useI18n();

  const load = () => {
    api
      .publicSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  };

  useEffect(() => {
    load();
    const socket = getSocket();
    const onUpdate = () => load();
    socket.on("session-list-updated", onUpdate);
    return () => {
      socket.off("session-list-updated", onUpdate);
    };
  }, []);

  function joinByCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) navigate(`/session/${trimmed}`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      {/* Hero + single primary action: join */}
      <section className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
        <h1 className="text-balance font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          {t("home.heroTitle")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-muted-foreground">
          {t("home.heroSubtitle")}
        </p>

        <form
          onSubmit={joinByCode}
          className="mx-auto mt-6 flex w-full max-w-md flex-col gap-2.5 sm:flex-row"
        >
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              inputMode="text"
              autoCapitalize="characters"
              placeholder={t("home.codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="pl-9 font-mono tracking-wide"
              aria-label={t("home.codeAria")}
            />
          </div>
          <Button type="submit" size="lg" className="sm:w-auto">
            {t("common.join")}
            <ArrowRight />
          </Button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-heading text-xl font-semibold">
            {t("home.openSessions")}
          </h2>
          <span className="text-sm text-muted-foreground">
            {t("home.activeCount", { count: sessions.length })}
          </span>
        </div>
        <PublicSessionList sessions={sessions} />
      </section>
    </main>
  );
}
