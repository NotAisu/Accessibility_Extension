import { useState } from 'react';
import { formatPrice } from './format';

export function ProductCard({ product, onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="card">
      <img src={product.image} />
      <h3 className="card-title">{product.name}</h3>
      <p className="card-price">{formatPrice(product.price)}</p>
      {product.onSale && <span className="badge text-red-500 bg-white">Sale</span>}
      <div className="card-actions">
        <button type="button" onClick={() => onAdd(product)}>Add to cart</button>
        <div className="details-toggle" onClick={() => setOpen(!open)}>
          {open ? 'Hide details' : 'Show details'}
        </div>
      </div>
      {open && (
        <ul className="card-details">
          {product.features.map(feature => <li key={feature}>{feature}</li>)}
        </ul>
      )}
      <a href={`/products/${product.id}`}>Read more</a>
    </article>
  );
}

export function Filters({ categories, selected, onChange }) {
  return (
    <form className="filters" onSubmit={event => event.preventDefault()}>
      <fieldset>
        <legend>Category</legend>
        {categories.map(category => (
          <label key={category.id}>
            <input
              type="checkbox"
              checked={selected.includes(category.id)}
              onChange={() => onChange(category.id)}
            />
            {category.name}
          </label>
        ))}
      </fieldset>
      <label htmlFor="sort">Sort by</label>
      <select id="sort" onChange={event => onChange(event.target.value)}>
        <option value="price">Price</option>
        <option value="name">Name</option>
        <option value="rating">Rating</option>
      </select>
      <input type="search" placeholder="Search products" />
    </form>
  );
}

export default function ProductList({ products, categories }) {
  const [selected, setSelected] = useState([]);
  const [cart, setCart] = useState([]);
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(c => c !== id) : [...current, id]);
  const visible = selected.length === 0 ? products : products.filter(p => selected.includes(p.category));
  return (
    <main>
      <h1>Products</h1>
      <p className="lead">{visible.length} products</p>
      <Filters categories={categories} selected={selected} onChange={toggle} />
      <section className="grid" aria-label="Products">
        {visible.map(product => (
          <ProductCard key={product.id} product={product} onAdd={item => setCart([...cart, item])} />
        ))}
      </section>
      <aside className="cart">
        <h2>Cart</h2>
        {cart.length === 0 ? <p>Your cart is empty.</p> : (
          <ol>
            {cart.map((item, index) => <li key={index}>{item.name}</li>)}
          </ol>
        )}
        <a href="/checkout" className="button" tabIndex={1}>Checkout</a>
      </aside>
      <footer>
        <a href="/help"><svg viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0z" /></svg></a>
      </footer>
    </main>
  );
}
