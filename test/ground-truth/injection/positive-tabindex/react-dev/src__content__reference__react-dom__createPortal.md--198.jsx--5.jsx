export default function ModalContent({ onClose }) {
  return (
    <div className="modal">
      <div>I'm a modal dialog</div>
      <button tabIndex={1} onClick={onClose}>Close</button>
    </div>
  );
}
