'use client';
import React, { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

type OverflowElement = {
  id: string;
  element: React.ReactNode;
  targetElement: HTMLElement;
};

type OverflowContextType = {
  registerOverflowElement: (
    id: string,
    element: React.ReactNode,
    targetElement: HTMLElement
  ) => void;
  unregisterOverflowElement: (id: string) => void;
};

const OverflowContext = createContext<OverflowContextType>({
  registerOverflowElement: () => {},
  unregisterOverflowElement: () => {},
});

export const useOverflowContext = () => useContext(OverflowContext);

export const OverflowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [overflowElements, setOverflowElements] = useState<
    Map<string, OverflowElement>
  >(new Map());

  const registerOverflowElement = useCallback(
    (id: string, element: React.ReactNode, targetElement: HTMLElement) => {
      setOverflowElements(
        prev => new Map(prev.set(id, { id, element, targetElement }))
      );
    },
    []
  );

  const unregisterOverflowElement = useCallback((id: string) => {
    setOverflowElements(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  }, []);

  const GlobalMenuCloser: React.FC = () => {
    React.useEffect(() => {
      const onPointerDown = (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('.rjft-action-menu')) return;
        if (target.closest('.rjft-handle')) return;
        window.dispatchEvent(new CustomEvent('rjft:close-all-menus'));
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
      };
    }, []);
    return null;
  };

  return (
    <OverflowContext.Provider
      value={{ registerOverflowElement, unregisterOverflowElement }}
    >
      {children}
      {/* 全局外部点击监听：点击非菜单与非把手区域时，关闭所有菜单 */}
      <GlobalMenuCloser />
      {/* 渲染所有需要超出边界的元素 */}
      {Array.from(overflowElements.values()).map(({ id, element }) =>
        createPortal(
          <div key={id} style={{ zIndex: 9999 }}>
            {element}
          </div>,
          document.body
        )
      )}
    </OverflowContext.Provider>
  );
};
