import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type HeaderSlotContextValue = {
  node: ReactNode;
  setNode: (node: ReactNode) => void;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  footerHidden: boolean;
  setFooterHidden: (hidden: boolean) => void;
};

const HeaderSlotContext = createContext<HeaderSlotContextValue>({
  node: null,
  setNode: () => {},
  hidden: false,
  setHidden: () => {},
  footerHidden: false,
  setFooterHidden: () => {},
});

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [hidden, setHidden] = useState(false);
  const [footerHidden, setFooterHidden] = useState(false);
  const setNodeStable = useCallback((n: ReactNode) => setNode(n), []);
  const setHiddenStable = useCallback((h: boolean) => setHidden(h), []);
  const setFooterHiddenStable = useCallback((h: boolean) => setFooterHidden(h), []);
  return (
    <HeaderSlotContext.Provider
      value={{
        node,
        setNode: setNodeStable,
        hidden,
        setHidden: setHiddenStable,
        footerHidden,
        setFooterHidden: setFooterHiddenStable,
      }}
    >
      {children}
    </HeaderSlotContext.Provider>
  );
}

export function useHeaderSlot(): HeaderSlotContextValue {
  return useContext(HeaderSlotContext);
}
