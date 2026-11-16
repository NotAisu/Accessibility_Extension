type Props = { onSubmit: () => void };

export const LoginForm = ({ onSubmit }: Props) => (
    <form onSubmit={onSubmit}>
        <label>Password <input type="password" autoComplete="current-password" /></label>
        <label>Code <input type="password" autoComplete="off" /></label>
        <button type="button" className="size-5" aria-label="Show password">*</button>
        <button type="submit" className="size-10">Go</button>
    </form>
);
