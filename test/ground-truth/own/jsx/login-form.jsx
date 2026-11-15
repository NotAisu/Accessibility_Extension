export const LoginForm = ({ onSubmit }) => (
    <form onSubmit={onSubmit}>
        <label>Email <input type="email" autoComplete="username" /></label>
        <label>Password <input type="password" autoComplete="off" /></label>
        <button type="button" className="w-4 h-4" aria-label="Show password">*</button>
        <button type="submit" className="h-10 px-4">Log in</button>
    </form>
);
