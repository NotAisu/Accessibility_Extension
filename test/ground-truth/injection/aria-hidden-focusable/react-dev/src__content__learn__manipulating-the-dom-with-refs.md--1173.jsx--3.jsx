export default function SearchButton({ onClick }) {
  return (
    <button aria-hidden="true" onClick={onClick}>
      Search
    </button>
  );
}
