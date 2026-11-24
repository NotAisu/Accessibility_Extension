// ✅ Components at module level
const ButtonComponent = () => <button>Click</button>;
const TextComponent = () => <div aria-labeledby="title">Text</div>;

function Parent({type}) {
  const Component = type === 'button'
    ? ButtonComponent  // Reference existing component
    : TextComponent;

  return <Component />;
}
