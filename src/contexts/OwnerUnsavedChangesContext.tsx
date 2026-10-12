import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type UnsavedChangesApi = {
  setUnsavedChanges: (dirty: boolean) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesApi | null>(null);

export function OwnerUnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const lastHashRef = useRef(window.location.hash || '');

  const setUnsavedChanges = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  useEffect(() => {
    const message = 'You have unsaved changes. Leave this page and discard them?';
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = message;
    };
    const handleHashChange = () => {
      const nextHash = window.location.hash || '';
      if (dirtyRef.current && nextHash !== lastHashRef.current) {
        if (!window.confirm(message)) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search + lastHashRef.current);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
          return;
        }
        dirtyRef.current = false;
        setDirty(false);
      }
      lastHashRef.current = nextHash;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handleLinkClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target && link.target !== '_self' || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = window.location.pathname + window.location.search + window.location.hash;
      const next = destination.pathname + destination.search + destination.hash;
      if (current === next || !destination.hash || destination.hash === lastHashRef.current) return;
      if (!window.confirm('You have unsaved changes. Leave this page and discard them?')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      } else {
        dirtyRef.current = false;
        setDirty(false);
      }
    };
    document.addEventListener('click', handleLinkClick, true);
    return () => document.removeEventListener('click', handleLinkClick, true);
  }, [dirty]);

  return <UnsavedChangesContext.Provider value={{ setUnsavedChanges }}>{children}</UnsavedChangesContext.Provider>;
}

export function useOwnerUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) return { setUnsavedChanges: (_dirty: boolean) => undefined };
  return context;
}
