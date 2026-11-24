import { Activity, ViewTransition, useState, startTransition } from 'react';

export default function App() {
  const [show, setShow] = useState(true);
  return (
    <div className="layout">
      <Toggle show={show} setShow={setShow} />
      <Activity mode={show ? 'visible' : 'hidden'}>
        <ViewTransition enter="auto" exit="auto" default="none">
          <Counter />
        </ViewTransition>
      </Activity>
    </div>
  );
}
function Toggle({show, setShow}) {
  return (
    <button
      className="toggle"
      onClick={() => {
        startTransition(() => {
          setShow(s => !s);
        });
      }}>
      {show ? 'Hide' : 'Show'}
    </button>
  )
}
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div className="counter">
      <h2>Counter</h2>
      <p>Count: {count}</p>
      <button tabIndex={1} onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}

