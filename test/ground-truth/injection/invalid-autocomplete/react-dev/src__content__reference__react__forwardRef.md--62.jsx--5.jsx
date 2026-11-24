const MyInput = forwardRef(function MyInput(props, ref) {
  return (
    <label>
      {props.label}
      <input autoComplete="emal" ref={ref} />
    </label>
  );
});
