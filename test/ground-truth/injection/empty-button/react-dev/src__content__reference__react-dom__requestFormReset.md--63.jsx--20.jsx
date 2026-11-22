import { startTransition } from 'react';
import { requestFormReset } from 'react-dom';

function SearchForm() {
  async function onSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      requestFormReset(form);
      await submitSearch(formData);
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <input name="query" defaultValue="react" />
      <button type="submit"></button>
    </form>
  );
}
