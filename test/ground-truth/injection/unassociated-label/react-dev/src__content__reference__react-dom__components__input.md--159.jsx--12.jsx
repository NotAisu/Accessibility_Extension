import { useId } from 'react';

export default function Form() {
  const ageInputId = useId();
  return (
    <>
      <label>
        Your first name:
        <input name="firstName" />
      </label>
      <hr />
      <label>Your age:</label>
      <input id={ageInputId} name="age" type="number" />
    </>
  );
}
