import { useCallback, useEffect, useMemo, useState } from 'react';
import { listRestaurantBranches } from './branchRepository';
import type { RestaurantBranch } from './branchTypes';

const storageKey = (restaurantId: string) => `web2table:selected-branch:${restaurantId}`;

export function useRestaurantBranches(restaurantId: string | undefined) {
  const [branches, setBranches] = useState<RestaurantBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setBranches([]);
    setSelectedBranchId(null);

    if (!restaurantId) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    void listRestaurantBranches(restaurantId, false)
      .then((loaded) => {
        if (cancelled) return;
        const active = loaded.filter((branch) => branch.is_active);
        setBranches(active);
        const key = storageKey(restaurantId);
        const stored = window.localStorage.getItem(key);
        const storedBranch = stored ? active.find((branch) => branch.id === stored) : undefined;
        const chosen = storedBranch ?? (active.length === 1 ? active[0] : undefined);
        setSelectedBranchId(chosen?.id ?? null);
        if (chosen) window.localStorage.setItem(key, chosen.id);
        else window.localStorage.removeItem(key);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load branches.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [restaurantId]);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const selectBranch = useCallback((branchId: string) => {
    const branch = branches.find((item) => item.id === branchId && item.is_active);
    if (!branch || !restaurantId) return false;
    window.localStorage.setItem(storageKey(restaurantId), branch.id);
    setSelectedBranchId(branch.id);
    return true;
  }, [branches, restaurantId]);

  return { branches, selectedBranch, selectedBranchId, selectBranch, loading, error };
}
