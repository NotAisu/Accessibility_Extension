function MyButton() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
  }

  return (
    <button tabIndex={1} onClick={handleClick}>
      Clicked {count} times
    </button>
  );
}
