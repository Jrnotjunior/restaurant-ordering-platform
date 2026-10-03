import { useEffect, useState } from 'react';
import type { RestaurantProduct } from '../types/menu';

type ProductCardProps = {
  product: RestaurantProduct;
  onAddToCart: (product: RestaurantProduct) => void;
};

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const [imageExpanded, setImageExpanded] = useState(false);

  useEffect(() => {
    if (!imageExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImageExpanded(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [imageExpanded]);

  return (
    <article className={`product-card${product.isAvailable ? '' : ' product-card-sold-out'}`} aria-label={product.isAvailable ? product.name : `${product.name}, sold out`}>
      {product.imageUrl ? (
        <>
          <button
            className="product-card-image-button"
            type="button"
            onClick={() => setImageExpanded(true)}
            aria-label={`View larger image of ${product.name}`}
          >
            <img className="product-card-image" src={product.imageUrl} alt="" loading="lazy" />
          </button>
          {imageExpanded ? (
            <div
              className="product-image-modal"
              role="dialog"
              aria-modal="true"
              aria-label={product.name}
              onClick={() => setImageExpanded(false)}
            >
              <button
                className="product-image-modal-close"
                type="button"
                onClick={() => setImageExpanded(false)}
                aria-label="Close image"
              >
                ×
              </button>
              <img
                className="product-image-modal-image"
                src={product.imageUrl}
                alt={product.name}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          ) : null}
        </>
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
