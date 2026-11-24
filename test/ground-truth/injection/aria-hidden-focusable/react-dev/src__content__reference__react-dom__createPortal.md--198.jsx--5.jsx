export default function ModalContent({ onClose }) {
  return (
    <div className="modal">
      <div>I'm a modal dialog</div>
      <button aria-hidden="true" onClick={onClose}>Close</button>
    </div>
  );
}
