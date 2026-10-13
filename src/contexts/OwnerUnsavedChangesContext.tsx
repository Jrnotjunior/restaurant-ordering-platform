import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type UnsavedChangesApi = {
  setUnsavedChanges: (dirty: boolean) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesApi | null>(null);

export function OwnerUnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const lastHashRef = useRef(window.location.hash || '');
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const setUnsavedChanges = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const handleHashChange = () => {
      lastHashRef.current = window.location.hash || '';
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
      if (current === next || (!destination.hash && destination.pathname === window.location.pathname && destination.search === window.location.search) || destination.hash === lastHashRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPendingHref(destination.href);
    };
    document.addEventListener('click', handleLinkClick, true);
    return () => document.removeEventListener('click', handleLinkClick, true);
  }, [dirty]);

  const stayOnPage = () => setPendingHref(null);
  const discardAndLeave = () => {
    const destination = pendingHref;
    setPendingHref(null);
    dirtyRef.current = false;
    setDirty(false);
    if (!destination) return;
    const url = new URL(destination, window.location.href);
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return;
    }
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      window.location.hash = url.hash;
      return;
    }
    window.location.assign(url.href);
  };

  return (
    <UnsavedChangesContext.Provider value={{ setUnsavedChanges }}>
      {children}
      {pendingHref && (
        <div
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) stayOnPage(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20,
            background: 'rgba(15, 23, 42, 0.58)', backdropFilter: 'blur(3px)',
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved-changes-title"
            aria-describedby="unsaved-changes-description"
            style={{
              width: 'min(100%, 440px)', boxSizing: 'border-box',
              padding: 24, borderRadius: 18, background: 'var(--color-surface, #fff)',
              color: 'var(--color-text, #111827)', border: '1px solid var(--color-border, #e5e7eb)',
              boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
              fontFamily: 'inherit',
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 13, display: 'grid',
              placeItems: 'center', marginBottom: 16, background: 'var(--color-primary, #111827)',
              color: 'var(--color-primary-text, #fff)', fontSize: 22, fontWeight: 800,
            }} aria-hidden="true">!</div>
            <h2 id="unsaved-changes-title" style={{ margin: '0 0 8px', fontSize: 20, lineHeight: 1.3, fontWeight: 750 }}>
              Unsaved changes
            </h2>
            <p id="unsaved-changes-description" style={{ margin: '0 0 24px', color: 'var(--color-muted, #64748b)', fontSize: 14, lineHeight: 1.6 }}>
              You have changes that haven’t been saved. If you leave this page now, your changes will be discarded.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={stayOnPage}
                style={{
                  minHeight: 42, padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
                  border: '1px solid var(--color-border, #d1d5db)', background: 'var(--color-surface, #fff)',
                  color: 'var(--color-text, #111827)', font: 'inherit', fontSize: 14, fontWeight: 650,
                }}
              >Stay on page</button>
              <button
                type="button"
                onClick={discardAndLeave}
                style={{
                  minHeight: 42, padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
                  border: '1px solid var(--color-primary, #111827)', background: 'var(--color-primary, #111827)',
                  color: 'var(--color-primary-text, #fff)', font: 'inherit', fontSize: 14, fontWeight: 700,
                }}
              >Discard changes</button>
            </div>
          </section>
        </div>
      )}
    </UnsavedChangesContext.Provider>
  );
}

export function useOwnerUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) return { setUnsavedChanges: (_dirty: boolean) => undefined };
  return context;
}
