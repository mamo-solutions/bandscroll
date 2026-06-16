import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/errorLog";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Localized inline — the boundary must not depend on app context (it may render
// precisely because that context threw). Falls back to the persisted language.
const lang =
  (typeof localStorage !== "undefined" && localStorage.getItem("bandscroll.lang")) === "de"
    ? "de"
    : "en";
const COPY =
  lang === "de"
    ? {
        title: "Etwas ist schiefgelaufen",
        body: "Die Ansicht ist auf einen Fehler gestoßen. Bitte lade die Seite neu.",
        reload: "Neu laden",
      }
    : {
        title: "Something went wrong",
        body: "This view ran into an error. Please reload the page.",
        reload: "Reload",
      };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError("react.render", error, {
      componentStack: info?.componentStack ?? undefined,
    });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <h1 className="font-heading text-xl font-bold">{COPY.title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{COPY.body}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 font-medium text-primary-foreground shadow-[var(--shadow-soft)] transition-colors hover:bg-primary/90"
        >
          {COPY.reload}
        </button>
      </div>
    );
  }
}
