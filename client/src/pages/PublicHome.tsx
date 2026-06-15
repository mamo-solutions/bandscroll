import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound } from "lucide-react";
import { api } from "@/api/client";
import { getSocket } from "@/sockets/socket";
import { PublicSessionList } from "@/components/PublicSessionList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionState } from "@/types/session";

export function PublicHome() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [code, setCode] = useState("");
  const navigate = useNavigate();

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
          Folge der Session in Echtzeit
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-muted-foreground">
          Das PDF scrollt automatisch synchron zum Host. Tritt einer offenen
          Session bei oder gib deinen Code ein.
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
              placeholder="Code, z. B. SESSION-7421"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="pl-9 font-mono tracking-wide"
              aria-label="Session-Code"
            />
          </div>
          <Button type="submit" size="lg" className="sm:w-auto">
            Beitreten
            <ArrowRight />
          </Button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-heading text-xl font-semibold">Offene Sessions</h2>
          <span className="text-sm text-muted-foreground">
            {sessions.length} aktiv
          </span>
        </div>
        <PublicSessionList sessions={sessions} />
      </section>
    </main>
  );
}
