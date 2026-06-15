import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dictionaries, type Lang, type TKey } from "./translations";

const STORAGE_KEY = "bandscroll.lang";

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "de" || stored === "en") return stored;
  // Fall back to the browser language; default to English for non-German.
  return navigator.language?.toLowerCase().startsWith("de") ? "de" : "en";
}

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  /** Translate a key, interpolating `{name}` placeholders from `vars`. */
  t: (key: TKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggleLang = useCallback(
    () => setLangState((l) => (l === "de" ? "en" : "de")),
    []
  );

  const t = useCallback<I18nValue["t"]>(
    (key, vars) => {
      let str = dictionaries[lang][key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [lang]
  );

  const value = useMemo(
    () => ({ lang, setLang, toggleLang, t }),
    [lang, setLang, toggleLang, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
