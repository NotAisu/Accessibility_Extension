const MyInput = forwardRef(function MyInput({ label }, ref) {
  return (
    <label>
      {label}
      <input autoComplete="emal" ref={ref} />
    </label>
  );
});
