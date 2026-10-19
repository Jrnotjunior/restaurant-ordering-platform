import type { RestaurantBranch } from '../branchTypes';
import '../branch.css';

type Props = {
  branches: RestaurantBranch[];
  selectedBranch: RestaurantBranch | null;
  onSelect: (branchId: string) => void;
  disabled?: boolean;
};

export function BranchSelector({ branches, selectedBranch, onSelect, disabled = false }: Props) {
  if (!branches.length) return null;

  if (!selectedBranch) {
    return (
      <section className="w2t-branch-choice" aria-labelledby="w2t-branch-choice-title">
        <div className="w2t-branch-choice-heading">
          <span className="w2t-branch-eyebrow">ONE BUSINESS · MULTIPLE LOCATIONS</span>
          <h2 id="w2t-branch-choice-title">Choose your branch</h2>
          <p>Select the restaurant location you want to order from.</p>
        </div>
        <div className="w2t-branch-choice-grid">
          {branches.map((branch) => (
            <button className="w2t-branch-choice-card" type="button" key={branch.id} onClick={() => onSelect(branch.id)} disabled={disabled}>
              <span className="w2t-branch-pin" aria-hidden="true">⌖</span>
              <span className="w2t-branch-choice-text">
                <strong>{branch.name}</strong>
                <span>{branch.restaurant_address || branch.store_address || 'Address not configured'}</span>
                <small>{branch.ordering_enabled ? 'Accepting orders when open' : 'Ordering currently paused'}</small>
              </span>
              <span className="w2t-branch-choice-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="w2t-selected-branch" aria-label="Selected restaurant branch">
      <div className="w2t-selected-branch-copy">
        <span className="w2t-branch-eyebrow">ORDERING FROM</span>
        <strong>{selectedBranch.name}</strong>
        <span>{selectedBranch.restaurant_address || selectedBranch.store_address || 'Address not configured'}</span>
        {!selectedBranch.ordering_enabled && <small className="w2t-branch-closed">This branch has paused online ordering.</small>}
      </div>
      <label className="w2t-branch-switcher">
        <span>Change branch</span>
        <select aria-label="Change branch" value={selectedBranch.id} disabled={disabled || branches.length < 2} onChange={(event) => onSelect(event.target.value)}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>
    </section>
  );
}
