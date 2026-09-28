import Link from 'next/link';
import { Flame, Home, Search } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-gradient text-white">
          <Flame size={24} aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-5xl font-black tracking-tight text-white">404</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-300">
          This page does not exist, or you do not have access to it.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/dashboard" className="btn-primary">
            <Home size={15} aria-hidden="true" />
            Go to dashboard
          </Link>
          <Link href="/projects" className="btn-secondary">
            <Search size={15} aria-hidden="true" />
            Browse projects
          </Link>
        </div>
      </div>
    </div>
  );
}
