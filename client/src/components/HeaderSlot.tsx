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
};

const HeaderSlotContext = createContext<HeaderSlotContextValue>({
  node: null,
  setNode: () => {},
});

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const setNodeStable = useCallback((n: ReactNode) => setNode(n), []);
  return (
    <HeaderSlotContext.Provider value={{ node, setNode: setNodeStable }}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

export function useHeaderSlot(): HeaderSlotContextValue {
  return useContext(HeaderSlotContext);
}
