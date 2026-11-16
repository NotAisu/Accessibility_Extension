import { FormEvent, useState } from 'react';

interface Props {
  onSubmit(values: SignupValues): Promise<void>;
  plans: { id: string; name: string; price: number }[];
}

export interface SignupValues {
  email: string;
  password: string;
  plan: string;
  newsletter: boolean;
}

export function SignupForm({ onSubmit, plans }: Props) {
  const [values, setValues] = useState<SignupValues>({ email: '', password: '', plan: plans[0]?.id ?? '', newsletter: false });
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const update = <K extends keyof SignupValues>(key: K, value: SignupValues[K]) =>
    setValues(current => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2>Create your account</h2>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={event => update('email', event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="off"
          value={values.password}
          onChange={event => update('password', event.target.value)}
        />
      </div>
      <fieldset className="plans">
        <legend>Plan</legend>
        {plans.map(plan => (
          <label key={plan.id} className="plan">
            <input
              type="radio"
              name="plan"
              value={plan.id}
              checked={values.plan === plan.id}
              onChange={() => update('plan', plan.id)}
            />
            <span>{plan.name}</span>
            <span className="price">{plan.price} € / month</span>
          </label>
        ))}
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={values.newsletter} onChange={event => update('newsletter', event.target.checked)} />
        Send me the newsletter
      </label>
      <p className="hint" style={{ color: '#aaa' }}>You can unsubscribe at any time.</p>
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <a href="/login">I already have an account</a>
        <span className="close" onClick={() => history.back()}>×</span>
      </div>
      <img src="/secure.svg" alt="image of a padlock" />
    </form>
  );
}

export function Terms({ accepted, onToggle }: { accepted: boolean; onToggle(): void }) {
  return (
    <section aria-labelledby="terms-heading">
      <h3 id="terms-heading">Terms</h3>
      <div className="terms-text" tabIndex={0}>
        <p>By creating an account you agree to the terms of service and the privacy policy.</p>
        <p>We store your email address to send you receipts and, if you agree, the newsletter.</p>
      </div>
      <label>
        <input type="checkbox" checked={accepted} onChange={onToggle} /> I accept the terms
      </label>
      <h4></h4>
    </section>
  );
}
