// ✅ Components at module level
const ButtonComponent = () => <button>Click</button>;
const TextComponent = () => <div aria-live="loud">Text</div>;

function Parent({type}) {
  const Component = type === 'button'
    ? ButtonComponent  // Reference existing component
    : TextComponent;

  return <Component />;
}
