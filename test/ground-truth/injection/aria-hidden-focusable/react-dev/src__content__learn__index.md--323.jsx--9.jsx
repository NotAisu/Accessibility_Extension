function MyButton() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
  }

  return (
    <button aria-hidden="true" onClick={handleClick}>
      Clicked {count} times
    </button>
  );
}
