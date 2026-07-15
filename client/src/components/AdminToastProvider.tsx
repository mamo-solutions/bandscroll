import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { api, ApiError, type MarkerGenerationSocketEvent } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translations";
import { cn } from "@/lib/utils";
import { getSocket, useSocketStatus } from "@/sockets/socket";
import type { AdminNotification } from "@/types/ai";

type ToastTone = "success" | "error";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type Toast = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: ToastAction;
};

type AdminToastContextValue = {
  pushToast: (toast: Toast) => void;
};

const AdminToastContext = createContext<AdminToastContextValue | null>(null);
const TOAST_LIFETIME_MS = 8000;

function titleForNotification(
  notification: Pick<AdminNotification, "status" | "sessionCode">,
  t: (key: TKey, vars?: Record<string, string | number>) => string
): string {
  return notification.status === "error"
    ? t("notify.markerErrorTitle", { code: notification.sessionCode })
    : t("notify.markerReadyTitle", { code: notification.sessionCode });
}

function descriptionForNotification(
  notification: {
    status: "ready" | "error";
    suggestionCount: number;
    message?: string;
    error?: string;
  },
  t: (key: TKey, vars?: Record<string, string | number>) => string
): string {
  if (notification.status === "error") {
    return notification.error || notification.message || t("notify.markerErrorDescFallback");
  }
  return notification.suggestionCount === 0
    ? t("notify.markerReadyDescEmpty")
    : t("notify.markerReadyDesc", { count: notification.suggestionCount });
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shownNotificationIds = useRef(new Set<string>());
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const socketStatus = useSocketStatus();
  const socket = getSocket();

  const pushToast = useCallback((toast: Toast) => {
    setToasts((current) => {
      const withoutExisting = current.filter((item) => item.id !== toast.id);
      return [...withoutExisting, toast];
    });
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const acknowledgeNotification = useCallback(async (notificationId: string) => {
    try {
      await api.ackAdminNotification(notificationId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return;
      }
    }
  }, []);

  const showNotificationToast = useCallback(
    (notification: AdminNotification | (MarkerGenerationSocketEvent & { message?: string })) => {
      const notificationId = "notificationId" in notification ? notification.notificationId : notification.id;
      if (shownNotificationIds.current.has(notificationId)) {
        return;
      }
      shownNotificationIds.current.add(notificationId);
      pushToast({
        id: notificationId,
        title: titleForNotification(notification, t),
        description: descriptionForNotification(notification, t),
        tone: notification.status === "error" ? "error" : "success",
        action: {
          label: t("notify.openSession"),
          onClick: () => navigate(`/admin/session/${notification.sessionId}`),
        },
      });
      void acknowledgeNotification(notificationId);
    },
    [acknowledgeNotification, navigate, pushToast, t]
  );

  const loadUnreadNotifications = useCallback(async () => {
    try {
      const notifications = await api.adminNotifications();
      for (const notification of notifications) {
        showNotificationToast(notification);
      }
    } catch {
      // Notification recovery should never block the admin UI.
    }
  }, [showNotificationToast]);

  useEffect(() => {
    void loadUnreadNotifications();
  }, [loadUnreadNotifications, location.key]);

  useEffect(() => {
    if (socketStatus.state !== "connected") return;
    void loadUnreadNotifications();
  }, [loadUnreadNotifications, socketStatus.state]);

  useEffect(() => {
    const onUpdated = (payload: MarkerGenerationSocketEvent) => {
      showNotificationToast(payload);
    };
    socket.on("admin-marker-generation-updated", onUpdated);
    return () => {
      socket.off("admin-marker-generation-updated", onUpdated);
    };
  }, [showNotificationToast, socket]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), TOAST_LIFETIME_MS)
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [dismissToast, toasts]);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <AdminToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-xl border bg-background/95 p-4 shadow-[var(--shadow-lift)] backdrop-blur-sm",
              toast.tone === "success"
                ? "border-success/25"
                : "border-destructive/25"
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  toast.tone === "success"
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"
                )}
              >
                {toast.tone === "success" ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <CircleAlert className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{toast.title}</p>
                {toast.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{toast.description}</p>
                )}
                {toast.action && (
                  <Button
                    variant="link"
                    className="mt-2 h-auto px-0 py-0 text-sm"
                    onClick={toast.action.onClick}
                  >
                    {toast.action.label}
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                onClick={() => dismissToast(toast.id)}
                aria-label={t("notify.dismiss")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </AdminToastContext.Provider>
  );
}

export function useAdminToast(): AdminToastContextValue {
  const value = useContext(AdminToastContext);
  if (!value) {
    throw new Error("useAdminToast must be used within AdminToastProvider");
  }
  return value;
}
