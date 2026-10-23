import { ErrorNote, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { loadScript } from '@/lib/scripts';
import { Loader2Icon, MailIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
    turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => void };
  }
}

function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <MailIcon className="size-4" />
          </span>
          PingX
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}

function GoogleButton() {
  const ref = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    void loadScript('https://accounts.google.com/gsi/client').then(() => {
      if (!ref.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          try {
            const { accessToken } = await api.post<{ accessToken: string }>('/auth/google', { credential });
            await signIn(accessToken);
            navigate('/');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
    });
  }, [signIn, navigate]);
  if (!GOOGLE_CLIENT_ID) return null;
  return (
    <>
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>
      <div ref={ref} className="flex justify-center" />
    </>
  );
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return { pending, error, submit };
}

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, submit } = useSubmit(async () => {
    const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', { email, password });
    await signIn(accessToken);
    navigate('/');
  });
  if (user) return <Navigate to="/" replace />;
  return (
    <AuthCard title="Sign in" description="Welcome back to PingX" footer={<>No account? <Link className="text-foreground underline" to="/signup">Create one</Link></>}>
      <form onSubmit={submit} className="grid gap-4">
        {error ? <ErrorNote error={error} /> : null}
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}Sign in
        </Button>
        <Link to="/forgot-password" className="text-center text-sm text-muted-foreground hover:underline">
          Forgot password?
        </Link>
      </form>
      <GoogleButton />
    </AuthCard>
  );
}

function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    void loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit').then(() => {
      if (ref.current && window.turnstile) window.turnstile.render(ref.current, { sitekey: TURNSTILE_SITE_KEY, callback: onToken });
    });
  }, [onToken]);
  return TURNSTILE_SITE_KEY ? <div ref={ref} /> : null;
}

export function SignupPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [captchaToken, setCaptchaToken] = useState<string>();
  const { pending, error, submit } = useSubmit(async () => {
    const { accessToken } = await api.post<{ accessToken: string }>('/auth/signup', { ...form, captchaToken });
    await signIn(accessToken);
    toast.success('Account created. Check your email to verify it.');
    navigate('/');
  });
  if (user) return <Navigate to="/" replace />;
  return (
    <AuthCard title="Create your account" description="Send email through your own providers" footer={<>Have an account? <Link className="text-foreground underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="grid gap-4">
        {error ? <ErrorNote error={error} /> : null}
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Turnstile onToken={setCaptchaToken} />
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}Create account
        </Button>
      </form>
      <GoogleButton />
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const { pending, error, submit } = useSubmit(async () => {
    await api.post('/auth/forgot-password', { email });
    setDone(true);
  });
  return (
    <AuthCard title="Reset password" description="We'll email you a reset link" footer={<Link className="underline" to="/login">Back to sign in</Link>}>
      {done ? (
        <p className="text-sm">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          {error ? <ErrorNote error={error} /> : null}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" disabled={pending}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const { pending, error, submit } = useSubmit(async () => {
    await api.post('/auth/reset-password', { token: params.get('token'), password });
    toast.success('Password updated. Sign in with your new password.');
    navigate('/login');
  });
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="grid gap-4">
        {error ? <ErrorNote error={error} /> : null}
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={pending}>Update password</Button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { user, reload } = useAuth();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const token = params.get('token');
  useEffect(() => {
    if (!token) return;
    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        setState('ok');
        if (user) await reload();
      })
      .catch((e) => {
        setState('error');
        setMessage(errorMessage(e));
      });
  }, [token]);
  return (
    <AuthCard title="Email verification">
      {state === 'pending' && <p className="text-sm text-muted-foreground">Verifying…</p>}
      {state === 'ok' && (
        <div className="grid gap-4">
          <p className="text-sm">Your email is verified. You can start sending.</p>
          <Link to="/" className="underline">Go to dashboard</Link>
        </div>
      )}
      {state === 'error' && <ErrorNote error={new Error(message)} />}
    </AuthCard>
  );
}
