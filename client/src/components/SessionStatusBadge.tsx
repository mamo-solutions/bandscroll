import { CircleDot, FileEdit, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translations";
import type { SessionStatus } from "@/types/session";

const MAP: Record<
  SessionStatus,
  { variant: "live" | "draft" | "ended"; key: TKey; Icon: typeof Radio }
> = {
  live: { variant: "live", key: "status.live", Icon: Radio },
  draft: { variant: "draft", key: "status.draft", Icon: FileEdit },
  ended: { variant: "ended", key: "status.ended", Icon: CircleDot },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { t } = useI18n();
  const { variant, key, Icon } = MAP[status];
  return (
    <Badge variant={variant}>
      <Icon className="size-3.5" />
      {t(key)}
    </Badge>
  );
}
