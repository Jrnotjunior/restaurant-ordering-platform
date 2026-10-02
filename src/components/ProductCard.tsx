import type { RestaurantProduct } from '../types/menu';

type ProductCardProps = {
  product: RestaurantProduct;
  onAddToCart: (product: RestaurantProduct) => void;
};

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  return (
    <article className={`product-card${product.isAvailable ? '' : ' product-card-sold-out'}`} aria-label={product.isAvailable ? product.name : `${product.name}, sold out`}>
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
        <button
          className={`button product-card-action${product.isAvailable ? ' button-primary' : ' product-card-sold-out-action'}`}
          type="button"
          onClick={() => onAddToCart(product)}
          disabled={!product.isAvailable}
          aria-disabled={!product.isAvailable}
        >
          {product.isAvailable ? 'Add to Cart' : 'Sold Out'}
        </button>
      </div>
    </article>
  );
}
