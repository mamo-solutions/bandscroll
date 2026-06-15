import { CircleDot, FileEdit, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SessionStatus } from "@/types/session";

const MAP: Record<
  SessionStatus,
  { variant: "live" | "draft" | "ended"; label: string; Icon: typeof Radio }
> = {
  live: { variant: "live", label: "Live", Icon: Radio },
  draft: { variant: "draft", label: "Entwurf", Icon: FileEdit },
  ended: { variant: "ended", label: "Beendet", Icon: CircleDot },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { variant, label, Icon } = MAP[status];
  return (
    <Badge variant={variant}>
      <Icon className="size-3.5" />
      {label}
    </Badge>
  );
}
