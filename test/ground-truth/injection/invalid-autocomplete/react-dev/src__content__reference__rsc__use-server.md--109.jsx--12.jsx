// App.js

async function requestUsername(formData) {
  'use server';
  const username = formData.get('username');
  // ...
}

export default function App() {
  return (
    <form action={requestUsername}>
      <input autoComplete="emal" type="text" name="username" />
      <button type="submit">Request</button>
    </form>
  );
}
