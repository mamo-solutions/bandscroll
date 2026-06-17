import { Link, Outlet } from "react-router-dom";
import { AudioLines } from "lucide-react";
import { Footer } from "@/components/Footer";
import { useHeaderSlot } from "@/components/HeaderSlot";
import { cn } from "@/lib/utils";

export function Layout() {
  const { node: headerNode, hidden: headerHidden } = useHeaderSlot();

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={cn(
          "sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md",
          headerHidden && "hidden"
        )}
      >
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-heading text-base font-semibold tracking-tight"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
              <AudioLines className="size-5" />
            </span>
            BandScroll
          </Link>

          {headerNode && (
            <div className="flex min-w-0 flex-1 items-center justify-end">
              {headerNode}
            </div>
          )}
        </div>
      </header>

      <Outlet />

      <Footer />
    </div>
  );
}
