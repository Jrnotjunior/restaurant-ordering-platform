import type { RestaurantProduct } from '../types/menu';

type ProductCardProps = {
  product: RestaurantProduct;
};

export function ProductCard({ product }: ProductCardProps) {
  return (
    <article className="product-card">
      {product.imageUrl ? (
        <img className="product-card-image" src={product.imageUrl} alt="" loading="lazy" />
      ) : (
        <div className="product-card-image product-card-image-placeholder" aria-hidden="true">
          <span>{product.name.charAt(0)}</span>
        </div>
      )}
      <div className="product-card-content">
        <div className="product-card-heading">
          <h3>{product.name}</h3>
          <span className="product-card-price">₱{product.price.toFixed(2)}</span>
        </div>
        {product.description ? <p>{product.description}</p> : null}
        <button className="button button-primary product-card-action" type="button">
          Add to Cart
        </button>
      </div>
    </article>
  );
}
