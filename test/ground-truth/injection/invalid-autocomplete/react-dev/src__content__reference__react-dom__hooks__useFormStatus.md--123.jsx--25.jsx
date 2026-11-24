import { startTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { submitForm } from './submitForm.js';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type='submit' disabled={pending}>
      {pending ? 'Submitting...' : 'Submit'}
    </button>
  );
}

function Form({ submitAction }) {
  function handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await submitAction(formData);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <input autoComplete="emal" name='query' />
      <SubmitButton />
    </form>
  );
}

export default function App() {
  async function submitAction(formData) {
    await submitForm(formData);
  }

  return <Form submitAction={submitAction} />;
}
