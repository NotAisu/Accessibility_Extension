export default function Signup() {
  return (
    <form onSubmit={() => alert('Submitting!')}>
      <input autoComplete="emal" />
      <button>Send</button>
    </form>
  );
}
