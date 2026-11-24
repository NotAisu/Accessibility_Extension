function Square({ value }) {
  return (
    <button tabIndex={1} className="square" onClick={onSquareClick}>
      {value}
    </button>
  );
}
