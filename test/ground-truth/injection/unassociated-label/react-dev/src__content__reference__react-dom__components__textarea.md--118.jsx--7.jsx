import { useId } from 'react';

export default function Form() {
  const postTextAreaId = useId();
  return (
    <>
      <label>
        Write your post:
      </label>
      <textarea
        id={postTextAreaId}
        name="postContent"
        rows={4}
        cols={40}
      />
    </>
  );
}
