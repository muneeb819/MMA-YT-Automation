'use client';

import { useEffect } from 'react';

/**
 * Global error boundary.
 * Shows a safe, human-readable message and never leaks a stack trace to the user.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side logging captures the detail; the client only gets a digest.
    console.error('Application error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="panel max-w-md p-8 text-center">
        <h1 className="text-xl font-black text-white">Something went wrong</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-300">
          The page hit an unexpected error. The details have been logged server-side — no internal
          information is shown here.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-ink-600">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex gap-2">
          <button onClick={reset} className="btn-primary flex-1">Try again</button>
          <a href="/dashboard" className="btn-secondary flex-1">Dashboard</a>
        </div>
      </div>
    </div>
  );
}
