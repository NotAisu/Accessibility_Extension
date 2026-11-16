export const Newsletter = ({ tone }) => (
    <form className="bg-white">
        <p className="text-gray-400">We send one email a month.</p>
        <p className="text-gray-700">Unsubscribe at any time.</p>
        <label className="text-gray-900">Email <input type="email" autoComplete="email" className="border border-gray-200 bg-white" /></label>
        <label className="text-gray-900">Name <input type="text" autoComplete="name" className="border border-gray-500 bg-white" /></label>
        <p className={tone}>Read our privacy policy.</p>
    </form>
);
