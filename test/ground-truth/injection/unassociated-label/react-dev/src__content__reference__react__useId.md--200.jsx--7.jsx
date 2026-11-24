import { useId } from 'react';

export default function Form() {
  const id = useId();
  return (
    <form>
      <label>First Name:</label>
      <input id={id + '-firstName'} type="text" />
      <hr />
      <label htmlFor={id + '-lastName'}>Last Name:</label>
      <input id={id + '-lastName'} type="text" />
    </form>
  );
}
