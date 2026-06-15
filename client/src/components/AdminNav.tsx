import { useNavigate } from "react-router-dom";
import { LayoutDashboard, LogOut } from "lucide-react";
import { auth } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

export function AdminNav({
  title,
  subtitle,
  showDashboard = true,
}: {
  title: string;
  subtitle?: string;
  showDashboard?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();

  async function handleLogout() {
    await auth.logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate font-heading text-2xl font-bold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showDashboard && (
          <Button variant="outline" size="sm" onClick={() => navigate("/admin")}>
            <LayoutDashboard />
            <span className="hidden sm:inline">{t("nav.dashboard")}</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut />
          <span className="hidden sm:inline">{t("nav.logout")}</span>
        </Button>
      </div>
    </div>
  );
}
