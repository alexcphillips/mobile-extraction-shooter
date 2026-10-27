import { ACCOUNT, type ProfileResponse } from '@mes/shared';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountError, signIn } from '../account';

type Mode = 'login' | 'register';

/** What's wrong with the form before sending it, or null. */
function problem(mode: Mode, username: string, password: string, confirm: string): string | null {
  if (mode === 'login') return username && password ? null : 'Enter your username and password.';
  if (!ACCOUNT.username.test(username)) return 'Usernames are 3 to 20 letters, digits, _ or -.';
  if (password.length < ACCOUNT.minPassword)
    return `Passwords need at least ${ACCOUNT.minPassword} characters.`;
  if (password.length > ACCOUNT.maxPassword) return 'That password is too long.';
  if (password !== confirm) return "The passwords don't match.";
  return null;
}

interface Props {
  onDone: (me: ProfileResponse) => void;
}

/**
 * Sign in or create an account: a plain form, so Safari and password managers fill and
 * save it (autocomplete names the fields). There's no password reset, so creating an
 * account asks for the password twice.
 */
function AccountScreen({ onDone }: Props): ReactNode {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const register = mode === 'register';

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const bad = problem(mode, username.trim(), password, confirm);
    setError(bad);
    if (bad) return;
    setBusy(true);
    signIn(mode, { username: username.trim(), password })
      .then(onDone)
      .catch((err: unknown) => {
        setError(err instanceof AccountError ? err.message : String(err));
        setBusy(false);
      });
  };

  const switchTo = (next: Mode): void => {
    setMode(next);
    setError(null);
    setConfirm('');
  };

  return (
    <div className="account">
      <form className="account-card" onSubmit={submit} noValidate>
        <h1>Extraction</h1>
        <h2>{register ? 'Create an account' : 'Sign in'}</h2>
        <label htmlFor={`${id}-user`}>Username</label>
        <input
          id={`${id}-user`}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        {register && <p className="account-hint">3 to 20 letters, digits, _ or -</p>}
        <label htmlFor={`${id}-pass`}>Password</label>
        <input
          id={`${id}-pass`}
          name="password"
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          maxLength={ACCOUNT.maxPassword}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {register && (
          <>
            <p className="account-hint">
              At least {ACCOUNT.minPassword} characters. There's no reset by email, so keep it safe.
            </p>
            <label htmlFor={`${id}-confirm`}>Password again</label>
            <input
              id={`${id}-confirm`}
              name="confirm"
              type="password"
              autoComplete="new-password"
              maxLength={ACCOUNT.maxPassword}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </>
        )}
        <p className="account-error" role="alert">
          {error}
        </p>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'One moment…' : register ? 'Create account' : 'Sign in'}
        </button>
        <p className="account-switch">
          {register ? 'Have an account? ' : 'New here? '}
          <button type="button" onClick={() => switchTo(register ? 'login' : 'register')}>
            {register ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </div>
  );
}

/**
 * Shows the sign-in screen over everything until someone signs in, then resolves with
 * their profile. Loaded lazily, like the other screens.
 */
export function showAccount(container: HTMLElement): Promise<ProfileResponse> {
  return new Promise((resolve) => {
    const root = createRoot(container);
    container.hidden = false;
    root.render(
      <AccountScreen
        onDone={(me) => {
          root.unmount();
          container.hidden = true;
          resolve(me);
        }}
      />,
    );
  });
}

export interface Message {
  title: string;
  /** One paragraph each. */
  text: string[];
  button: string;
}

/** A screen with a title, a few lines and one button. */
function MessageScreen({ message, onDone }: { message: Message; onDone: () => void }): ReactNode {
  return (
    <div className="account">
      <div className="account-card" role="alertdialog" aria-label={message.title}>
        <h1>Extraction</h1>
        <h2>{message.title}</h2>
        {message.text.map((t) => (
          <p key={t} className="account-text">
            {t}
          </p>
        ))}
        <button type="button" className="primary" onClick={onDone}>
          {message.button}
        </button>
      </div>
    </div>
  );
}

/**
 * Shows a message over everything (no connection, or news about the last raid) and
 * resolves when its button is pressed. Uses the sign-in screen's place and look.
 */
export function showMessage(container: HTMLElement, message: Message): Promise<void> {
  return new Promise((resolve) => {
    const root = createRoot(container);
    container.hidden = false;
    root.render(
      <MessageScreen
        message={message}
        onDone={() => {
          root.unmount();
          container.hidden = true;
          resolve();
        }}
      />,
    );
  });
}
