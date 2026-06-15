import { Link } from "react-router-dom";
import { Languages, Mic2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LANGUAGES } from "@/i18n/translations";

export function Footer() {
  const { t, lang, setLang } = useI18n();

  // Split the localized credit template around its {link} placeholder so we can
  // render a real anchor in the middle.
  const [before, after] = t("footer.project").split("{link}");
  const other = LANGUAGES.find((l) => l.code !== lang)!;

  return (
    <footer className="mt-auto border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-5 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <p>
          <span className="font-heading font-semibold text-foreground">
            BandScroll
          </span>{" "}
          — {before}
          <a
            href="https://mamo.solutions"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            mamo.solutions
          </a>
          {after}
        </p>

        <div className="flex items-center gap-1">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mic2 className="size-4" />
            {t("footer.hostSession")}
          </Link>
          <button
            type="button"
            onClick={() => setLang(other.code)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Sprache wechseln: ${other.label}`}
          >
            <Languages className="size-4" />
            {other.label}
          </button>
        </div>
      </div>
    </footer>
  );
}
