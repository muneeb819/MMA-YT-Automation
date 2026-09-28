'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Flame, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { Button, Field, Input, Spinner } from '@/components/ui';
import { api, ApiClientError } from '@/lib/api-client';
import { MOCK_MODE_TEXT } from '@/lib/ui-copy';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';

  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/auth', { email, password, ...(mode === 'signup' ? { name } : {}) });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
      setBusy(false);
    }
  }

  async function demoSignIn() {
    setError(null);
    setBusy(true);
    try {
      await api.put('/api/auth/demo');
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-gradient text-white">
            <Flame size={20} aria-hidden="true" />
          </span>
          <span className="text-xl font-black tracking-tight text-white">ShortForge AI</span>
        </Link>

        <div className="panel p-7">
          <h1 className="text-xl font-black text-white">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-1.5 text-sm text-ink-400">
            {mode === 'signup'
              ? 'Start turning ideas into finished shorts.'
              : 'Sign in to continue generating.'}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <Field label="Name" htmlFor="name">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
            )}

            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>

            <Field label="Password" htmlFor="password" required hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-ember/40 bg-ember/10 p-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-ember" aria-hidden="true" />
                <p className="text-xs text-ember">{error}</p>
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" disabled={busy} loading={busy}>
              {mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-700" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">or</span>
            <span className="h-px flex-1 bg-ink-700" />
          </div>

          <Button variant="secondary" className="w-full" onClick={demoSignIn} disabled={busy}>
            Continue with demo account
          </Button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-500">{MOCK_MODE_TEXT}</p>

          <p className="mt-5 text-center text-sm text-ink-400">
            {mode === 'signup' ? 'Already have an account?' : 'New to ShortForge?'}{' '}
            <button
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}
              className="font-semibold text-accent-soft hover:underline"
            >
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </div>

        <Link
          href="/"
          className="mt-6 flex items-center justify-center gap-1.5 text-xs text-ink-500 hover:text-ink-300"
        >
          Back to home <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
