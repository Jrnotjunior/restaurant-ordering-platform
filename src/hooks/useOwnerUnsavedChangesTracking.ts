import { useEffect } from 'react';
import { useOwnerUnsavedChanges } from '../contexts/OwnerUnsavedChangesContext';

/**
 * Tracks edits only inside the current owner module.
 * Modules explicitly clear the shared guard after their persistence operation succeeds.
 */
export function useOwnerUnsavedChangesTracking(containerSelector: string) {
  const { setUnsavedChanges } = useOwnerUnsavedChanges();

  useEffect(() => {
    const markDirty = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(containerSelector)) {
        setUnsavedChanges(true);
      }
    };

    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);

    return () => {
      document.removeEventListener('input', markDirty, true);
      document.removeEventListener('change', markDirty, true);
    };
  }, [containerSelector, setUnsavedChanges]);
}
