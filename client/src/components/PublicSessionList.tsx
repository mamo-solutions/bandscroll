import { useNavigate } from "react-router-dom";
import { ArrowRight, Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import type { SessionState } from "@/types/session";

export function PublicSessionList({ sessions }: { sessions: SessionState[] }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  if (sessions.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Inbox className="size-6" />
        </span>
        <p className="font-medium">{t("list.emptyTitle")}</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {t("list.emptyDesc")}
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((s) => (
        <Card
          key={s.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/session/${s.code}`)}
          onKeyDown={(e) =>
            (e.key === "Enter" || e.key === " ") &&
            (e.preventDefault(), navigate(`/session/${s.code}`))
          }
          className="group flex cursor-pointer flex-col gap-4 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-heading text-lg font-semibold leading-snug">
              {s.title}
            </h3>
          </div>

          {s.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {s.description}
            </p>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
            <span className="rounded-lg bg-secondary px-2.5 py-1 font-mono text-sm font-semibold tracking-wide text-secondary-foreground">
              {s.code}
            </span>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/session/${s.code}`);
              }}
            >
              {t("common.join")}
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
