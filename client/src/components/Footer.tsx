import { Link } from "react-router-dom";
import { Languages, Mic2 } from "lucide-react";

// GitHub's brand mark (lucide dropped its brand icons). Uses currentColor so it
// matches the surrounding text color.
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
import { useI18n } from "@/i18n/I18nProvider";
import { LANGUAGES } from "@/i18n/translations";
import { APP_VERSION } from "@/version";

export function Footer() {
  const { t, lang, setLang } = useI18n();

  // Split the localized credit template around its {link} placeholder so we can
  // render a real anchor in the middle.
  const [before, after] = t("footer.project").split("{link}");
  const other = LANGUAGES.find((l) => l.code !== lang)!;

  return (
    <footer className="mt-auto border-t border-border/50">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground sm:justify-between sm:px-6">
        <p className="text-center sm:text-left">
          <span className="font-heading font-semibold text-foreground/90">
            BandScroll
          </span>{" "}
          {before}
          <a
            href="https://mamo.solutions"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
          >
            mamo.solutions
          </a>
          {after}
          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
            {APP_VERSION}
          </span>
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a
            href="https://github.com/mamo-solutions/bandscroll"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GithubMark />
            GitHub
          </a>
          <Link
            to="/admin"
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mic2 className="size-4" />
            {t("footer.hostSession")}
          </Link>
          <button
            type="button"
            onClick={() => setLang(other.code)}
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
