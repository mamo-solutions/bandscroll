import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { auth } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    auth.me().then((ok) => ok && navigate("/admin", { replace: true }));
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const ok = await auth.login(password);
    setBusy(false);
    setPassword("");
    if (ok) navigate("/admin", { replace: true });
    else setError(true);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-20">
      <Card className="shadow-[var(--shadow-lift)]">
        <CardHeader className="items-center text-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
            <Lock className="size-6" />
          </span>
          <CardTitle className="text-2xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pw">{t("login.password")}</Label>
              <div className="relative">
                <Input
                  id="pw"
                  type={show ? "text" : "password"}
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-11"
                  aria-invalid={error}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={show ? t("login.hidePassword") : t("login.showPassword")}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              >
                <AlertCircle className="size-4 shrink-0" />
                {t("login.error")}
              </p>
            )}

            <Button type="submit" size="lg" disabled={busy || !password}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? t("login.checking") : t("login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
