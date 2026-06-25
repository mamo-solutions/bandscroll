import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type DocumentAccessLinkProps = {
  href: string;
  className?: string;
  inverse?: boolean;
};

export function DocumentAccessLink({
  href,
  className,
  inverse = false,
}: DocumentAccessLinkProps) {
  const { t } = useI18n();

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "fixed left-4 bottom-4 z-50 max-w-[calc(100vw-8rem)] justify-center shadow-[var(--shadow-lift)] backdrop-blur-md",
        inverse
          ? "border-white/15 bg-black/88 text-white hover:bg-black"
          : "border-border/80 bg-background/92",
        className
      )}
    >
      <a href={href} target="_blank" rel="noreferrer">
        <ExternalLink />
        {t("common.openOriginal")}
      </a>
    </Button>
  );
}
