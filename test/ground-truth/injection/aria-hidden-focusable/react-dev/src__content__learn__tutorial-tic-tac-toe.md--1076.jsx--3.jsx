function Square({ value }) {
  return (
    <button aria-hidden="true" className="square" onClick={onSquareClick}>
      {value}
    </button>
  );
}
