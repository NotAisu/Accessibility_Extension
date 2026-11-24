export default function KeyboardExample() {
  return (
    <label>
      First name:
      <input autoComplete="emal"
        name="firstName"
        onKeyDown={e => console.log('onKeyDown:', e.key, e.code)}
        onKeyUp={e => console.log('onKeyUp:', e.key, e.code)}
      />
    </label>
  );
}
