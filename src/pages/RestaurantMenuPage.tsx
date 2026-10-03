import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createProduct, deleteProduct, getMenu, getOrCreateCategory, setProductAvailability, updateProduct } from '../services/menuRepository';
import { saveProductImage, uploadProductImage } from '../services/productImageRepository';
import type { RestaurantCategory, RestaurantProduct } from '../types/menu';

type Props = { restaurantId: string };
type ProductForm = { name: string; description: string; price: string; categoryName: string };

const emptyForm: ProductForm = { name: '', description: '', price: '', categoryName: '' };

export function RestaurantMenuPage({ restaurantId }: Props) {
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showUnavailable, setShowUnavailable] = useState(true);
  const [searchProduct, setSearchProduct] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editingProduct, setEditingProduct] = useState<RestaurantProduct | null>(null);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [savingForm, setSavingForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadMenu() {
    try {
      setError('');
      const menu = await getMenu(restaurantId, true);
      setCategories(menu.categories);
      setProducts(menu.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadMenu(); }, [restaurantId]);

  const filteredProducts = useMemo(() => {
    const query = searchProduct.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = selectedCategory === 'all' || product.categoryId === selectedCategory;
      const availabilityMatch = showUnavailable || product.isAvailable;
      const category = categories.find((item) => item.id === product.categoryId);
      const searchMatch = !query
        || product.name.toLowerCase().includes(query)
        || product.description.toLowerCase().includes(query)
        || Boolean(category?.name.toLowerCase().includes(query));
      return categoryMatch && availabilityMatch && searchMatch;
    });
  }, [products, categories, selectedCategory, showUnavailable, searchProduct]);

  async function toggleAvailability(product: RestaurantProduct) {
    setSavingId(product.id);
    setError('');
    try {
      await setProductAvailability(product.id, !product.isAvailable, restaurantId);
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, isAvailable: !item.isAvailable } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update availability.');
    } finally {
      setSavingId(null);
    }
  }

  function openAdd() {
    setEditingProduct(null);
    setIsAddingProduct(true);
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview('');
    setError('');
  }

  function openEdit(product: RestaurantProduct) {
    setIsAddingProduct(false);
    setEditingProduct(product);
    const category = categories.find((item) => item.id === product.categoryId);
    setForm({ name: product.name, description: product.description, price: String(product.price), categoryName: category?.name ?? '' });
    setImageFile(null);
    setImagePreview(product.imageUrl || '');
    setError('');
  }

  function closeProductModal() {
    if (savingForm) return;
    setEditingProduct(null);
    setIsAddingProduct(false);
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview('');
  }

  function handleImageChange(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use a JPG, PNG, or WEBP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Product images must be 5 MB or smaller.');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const description = form.description.trim();
    const categoryName = form.categoryName.trim();
    const price = Number(form.price);

    if (!name) { setError('Product name is required.'); return; }
    if (!Number.isFinite(price) || price < 0) { setError('Enter a valid price.'); return; }
    if (!categoryName) { setError('Category is required.'); return; }

    setSavingForm(true);
    setError('');
    try {
      const categoryId = await getOrCreateCategory(restaurantId, categoryName);

      if (isAddingProduct) {
        const productId = await createProduct({ restaurantId, name, description, price, categoryId });
        if (imageFile) {
          const imageUrl = await uploadProductImage(restaurantId, productId, imageFile);
          await saveProductImage(productId, imageUrl);
        }
      } else if (editingProduct) {
        if (imageFile) {
          const imageUrl = await uploadProductImage(restaurantId, editingProduct.id, imageFile);
          await saveProductImage(editingProduct.id, imageUrl);
        }
        await updateProduct(editingProduct, { name, description, price, categoryId });
      }

      await loadMenu();
      setSavingForm(false);
      closeProductModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : isAddingProduct ? 'Unable to add product.' : 'Unable to update product.');
      setSavingForm(false);
    }
  }

  async function removeProduct(product: RestaurantProduct) {
    const confirmed = window.confirm(
      `Delete ${product.name}?\n\nThis will remove the product from the restaurant products list.`
    );
    if (!confirmed) return;

    setDeletingId(product.id);
    setError('');
    try {
      await deleteProduct(product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete product.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="restaurant-page restaurant-menu-page">
      <style>{`
        .restaurant-menu-search{display:flex;align-items:center;gap:10px;margin:18px 0 14px}
        .restaurant-menu-search-input-wrap{position:relative;flex:1;max-width:360px}
        .restaurant-menu-search input{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 40px 11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-menu-search input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-menu-search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:999px;background:#f1f5f9;color:#475569;font-size:18px;line-height:1;cursor:pointer}
        .restaurant-menu-search-label{font-size:14px;font-weight:600;color:#475569;white-space:nowrap}
        .restaurant-menu-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
        .restaurant-menu-header > div{min-width:0}
        .restaurant-menu-section-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
        .restaurant-menu-section-header > div{min-width:0}
        .restaurant-menu-section-header h2{margin:0 0 4px}
        .restaurant-menu-section-header p{margin:0;color:#64748b}
        .restaurant-menu-add-button{min-height:42px;white-space:nowrap;flex-shrink:0}
        .restaurant-menu-management-card{border:1px solid #e1e5eb;border-radius:14px;padding:18px;margin-top:22px;background:#fff}
        .restaurant-menu-management-card .restaurant-menu-search{margin-top:18px}
        .restaurant-menu-card-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px}
        .restaurant-menu-card-actions .button{min-height:38px}
        .restaurant-product-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
        .restaurant-product-modal{position:relative;width:min(520px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:24px;color:#0f172a}
        .restaurant-product-modal h2{margin:0 42px 18px 0}
        .restaurant-product-modal-close{position:absolute;right:14px;top:14px;width:38px;height:38px;border:0;border-radius:999px;background:#f1f5f9;font-size:22px;cursor:pointer}
        .restaurant-product-form{display:grid;gap:14px}
        .restaurant-product-form label{display:grid;gap:6px;font-weight:600;font-size:14px}
        .restaurant-product-form input,.restaurant-product-form textarea{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-product-form input[type=number]{-moz-appearance:textfield}
        .restaurant-product-form input[type=number]::-webkit-inner-spin-button,.restaurant-product-form input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        .restaurant-product-form input[list]{padding-right:12px}
        .restaurant-product-form input[list]::-webkit-calendar-picker-indicator{display:none!important;opacity:0;width:0;margin:0}
        .restaurant-product-form textarea{min-height:90px;resize:vertical}
        .restaurant-product-image-picker{display:grid;gap:10px}
        .restaurant-product-image-preview{display:block;width:100%;aspect-ratio:1 / 1;height:auto;object-fit:cover;border-radius:12px;border:1px solid #dbe2ea;background:#f8fafc}
        .restaurant-product-image-placeholder{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1 / 1;height:auto;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;color:#64748b}
        .restaurant-product-image-picker input[type=file]{display:none}
        .restaurant-product-image-picker .button{justify-self:center}
        .restaurant-product-form-actions{display:flex;justify-content:center;gap:10px;margin-top:4px}
        .restaurant-product-form-actions .button{min-width:130px}
        .restaurant-product-category-hint{font-size:12px;font-weight:400;color:#64748b}
        @media(max-width:600px){.restaurant-menu-section-header{flex-direction:column}.restaurant-menu-add-button{width:100%}.restaurant-menu-search{align-items:stretch;flex-direction:column}.restaurant-menu-search-label{white-space:normal}.restaurant-menu-search-input-wrap{max-width:none}.restaurant-product-modal-backdrop{padding:10px;align-items:flex-end}.restaurant-product-modal{max-height:92vh;border-radius:18px 18px 12px 12px;padding:20px}.restaurant-product-form-actions .button{flex:1}}
      `}</style>

      {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}

      <div className="restaurant-menu-management-card">
        <div className="restaurant-menu-section-header">
          <div>
            <h2>Product Menu</h2>
            <p>Manage the products customers can order from your restaurant.</p>
          </div>
          <button className="button restaurant-menu-add-button" type="button" onClick={openAdd} disabled={loading}>+ Add Product</button>
        </div>

        <div className="restaurant-menu-search">
          <label className="restaurant-menu-search-label" htmlFor="restaurant-product-search">Search products</label>
          <div className="restaurant-menu-search-input-wrap">
            <input
              id="restaurant-product-search"
              type="search"
              value={searchProduct}
              onChange={(event) => setSearchProduct(event.target.value)}
              placeholder="Search by product name, description, or category"
            />
            {searchProduct && (
              <button type="button" className="restaurant-menu-search-clear" onClick={() => setSearchProduct('')} aria-label="Clear product search">×</button>
            )}
          </div>
        </div>

        <div className="restaurant-menu-toolbar">
          <div className="restaurant-menu-categories" aria-label="Product categories">
            <button className={selectedCategory === 'all' ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory('all')}>All</button>
            {categories.map((category) => (
              <button key={category.id} className={selectedCategory === category.id ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory(category.id)}>
                {category.name}
              </button>
            ))}
          </div>
          <label className="restaurant-menu-toggle">
            <input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} />
            <span>Show unavailable</span>
          </label>
        </div>

        {loading ? (
          <div className="restaurant-dashboard-empty">Loading products…</div>
        ) : filteredProducts.length === 0 ? (
          <div className="restaurant-dashboard-empty">No products match this filter.</div>
        ) : (
          <div className="restaurant-menu-grid">
            {filteredProducts.map((product) => (
              <article className={`product-card restaurant-management-product-card${product.isAvailable ? '' : ' product-card-sold-out'}`} key={product.id}>
                <div className="product-card-main">
                  <div className="product-card-media">
                    {product.imageUrl
                      ? <img className="product-card-image" src={product.imageUrl} alt="" loading="lazy" />
                      : <div className="product-card-image product-card-image-placeholder" aria-hidden="true"><span>{product.name.charAt(0).toUpperCase()}</span></div>}
                  </div>
                  <div className="product-card-content">
                    <h3>{product.name}</h3>
                    <span className="product-card-price">₱{product.price.toFixed(2)}</span>
                    <p>{product.description || 'No description.'}</p>
                  </div>
                </div>
                <div className="restaurant-management-product-status">
                  {product.isAvailable ? 'Available' : 'Unavailable'}
                </div>
                <div className="restaurant-management-product-actions">
                  <button className="button restaurant-management-product-icon" type="button" disabled={savingId === product.id} onClick={() => void toggleAvailability(product)} aria-label={product.isAvailable ? `Mark ${product.name} unavailable` : `Make ${product.name} available`}>
                    {savingId === product.id ? '…' : product.isAvailable ? '−' : '+'}
                  </button>
                  <button className="button restaurant-management-product-icon" type="button" disabled={deletingId === product.id} onClick={() => openEdit(product)} aria-label={`Edit ${product.name}`}>✎</button>
                  <button className="button restaurant-management-product-icon is-danger" type="button" disabled={deletingId === product.id} onClick={() => void removeProduct(product)} aria-label={`Delete ${product.name}`}>
                    {deletingId === product.id ? '…' : '×'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {(editingProduct || isAddingProduct) && (
        <div className="restaurant-product-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingForm) closeProductModal(); }}>
          <div className="restaurant-product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
            <button className="restaurant-product-modal-close" type="button" disabled={savingForm} onClick={closeProductModal}>×</button>
            <h2 id="product-modal-title">{isAddingProduct ? 'Add Product' : 'Edit Product'}</h2>
            <form className="restaurant-product-form" onSubmit={(event) => void saveProduct(event)}>
              <div className="restaurant-product-image-picker">
                {imagePreview
                  ? <img src={imagePreview} alt="Product preview" className="restaurant-product-image-preview" />
                  : <div className="restaurant-product-image-placeholder">No product image</div>}
                <label className="button button-secondary" htmlFor="product-image-input">{imagePreview ? 'Change Image' : 'Add Image'}</label>
                <input id="product-image-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => handleImageChange(event.target.files?.[0])} disabled={savingForm} />
                <small>JPG, PNG, or WEBP · maximum 5 MB</small>
              </div>
              <label>Product name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus /></label>
              <label>Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label>Price<input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} /></label>
              <label>
                Category
                <input
                  list="restaurant-product-categories"
                  value={form.categoryName}
                  placeholder="Enter or choose a category"
                  onChange={(event) => setForm((current) => ({ ...current, categoryName: event.target.value }))}
                />
                <datalist id="restaurant-product-categories">
                  {categories.map((category) => <option key={category.id} value={category.name} />)}
                </datalist>
                <span className="restaurant-product-category-hint">Choose an existing category or enter a new one. New categories are added automatically.</span>
              </label>
              <div className="restaurant-product-form-actions">
                <button className="button button-secondary" type="button" disabled={savingForm} onClick={closeProductModal}>Cancel</button>
                <button className="button button-primary" type="submit" disabled={savingForm}>{savingForm ? 'Saving…' : isAddingProduct ? 'Add Product' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
