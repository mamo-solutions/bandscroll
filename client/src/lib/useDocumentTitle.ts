import { useEffect } from "react";

const BRAND = "BandScroll";

/**
 * Sets the document title for the current page, suffixed with the brand
 * (e.g. "Dashboard · BandScroll"). Pass a falsy value for the bare brand.
 */
export function useDocumentTitle(label?: string | null) {
  useEffect(() => {
    document.title = label ? `${label} · ${BRAND}` : BRAND;
    return () => {
      document.title = BRAND;
    };
  }, [label]);
}
