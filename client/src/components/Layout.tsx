import { Link, Outlet } from "react-router-dom";
import { AudioLines } from "lucide-react";
import { Footer } from "@/components/Footer";

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
            BandScroll
          </Link>
        </div>
      </header>

      <Outlet />

      <Footer />
    </div>
  );
}
