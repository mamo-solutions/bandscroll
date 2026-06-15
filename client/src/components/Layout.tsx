import { Link, NavLink, Outlet } from "react-router-dom";
import { AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-heading text-base font-semibold tracking-tight"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
              <AudioLines className="size-5" />
            </span>
            play-a-sync
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <HeaderLink to="/">Sessions</HeaderLink>
            <HeaderLink to="/admin">Host</HeaderLink>
          </nav>
        </div>
      </header>

      <Outlet />
    </div>
  );
}

function HeaderLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "rounded-lg px-3 py-2 font-medium transition-colors",
          isActive
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
        )
      }
    >
      {children}
    </NavLink>
  );
}
