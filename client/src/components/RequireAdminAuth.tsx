import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { auth } from "@/api/auth";
import { useI18n } from "@/i18n/I18nProvider";

/** Guards admin routes by checking the server session via /api/admin/me. */
export function RequireAdminAuth({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    let active = true;
    auth.me().then((isAdmin) => {
      if (active) setState(isAdmin ? "ok" : "denied");
    });
    return () => {
      active = false;
    };
  }, []);

  if (state === "checking") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">{t("auth.checking")}</p>
      </div>
    );
  }
  if (state === "denied") {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
