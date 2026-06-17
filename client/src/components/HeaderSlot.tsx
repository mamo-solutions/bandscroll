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
};

const HeaderSlotContext = createContext<HeaderSlotContextValue>({
  node: null,
  setNode: () => {},
  hidden: false,
  setHidden: () => {},
});

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [hidden, setHidden] = useState(false);
  const setNodeStable = useCallback((n: ReactNode) => setNode(n), []);
  const setHiddenStable = useCallback((h: boolean) => setHidden(h), []);
  return (
    <HeaderSlotContext.Provider
      value={{ node, setNode: setNodeStable, hidden, setHidden: setHiddenStable }}
    >
      {children}
    </HeaderSlotContext.Provider>
  );
}

export function useHeaderSlot(): HeaderSlotContextValue {
  return useContext(HeaderSlotContext);
}
