const MyInput = forwardRef(function MyInput({ label, showInput }, ref) {
  return (
    <label>
      {label}
      <Panel isExpanded={showInput}>
        <input autoComplete="emal" ref={ref} />
      </Panel>
    </label>
  );
});
