'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  BarChart3, Clapperboard, CreditCard, FolderOpen, LayoutDashboard, Menu, Palette,
  Search, Settings, Youtube, X, Zap, Bell, Flame,
} from 'lucide-react';
import { DemoBadge, Button } from './ui';
import { useMediaQuery } from './providers';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/create', label: 'Create Short', icon: Zap },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/templates', label: 'Templates', icon: Clapperboard },
  { href: '/voices', label: 'Voices', icon: Palette },
  { href: '/visual-styles', label: 'Visual Styles', icon: Clapperboard },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/youtube', label: 'YouTube', icon: Youtube },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({
  children,
  credits,
  demoMode,
  userName,
  isAdmin,
}: {
  children: ReactNode;
  credits: number;
  demoMode: boolean;
  userName: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const nav = isAdmin ? [...NAV, { href: '/admin', label: 'Admin', icon: CreditCard }] : NAV;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-gradient text-white shadow-lg shadow-accent/25">
          <Flame size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-black tracking-tight text-white">ShortForge AI</p>
          <p className="truncate text-[10px] text-ink-400">Shorts automation</p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {nav.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={() => setDrawerOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                active
                  ? 'bg-accent/15 text-white ring-1 ring-inset ring-accent/30'
                  : 'text-ink-300 hover:bg-ink-800/70 hover:text-ink-100'
              }`}
            >
              <Icon size={17} aria-hidden="true" className="shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-800 p-3">
        <Link
          href="/create"
          className="btn-primary w-full"
          onClick={() => setDrawerOpen(false)}
        >
          <Zap size={16} aria-hidden="true" />
          Generate Short
        </Link>
        {demoMode && (
          <div className="mt-3">
            <DemoBadge />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-ink-800 bg-ink-900/60 backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {!isDesktop && drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative h-full w-72 border-r border-ink-800 bg-ink-900">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-2 text-ink-300 hover:bg-ink-800"
              aria-label="Close navigation menu"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-xl border border-ink-700 p-2 text-ink-200 hover:bg-ink-800 lg:hidden"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <Menu size={18} />
            </button>

            <div className="relative hidden flex-1 sm:block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search projects"
                placeholder="Search projects…"
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setSearchOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    window.location.href = `/projects?q=${encodeURIComponent((e.target as HTMLInputElement).value)}`;
                  }
                }}
                className="input pl-9"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/projects"
                className="chip hover:border-ink-600"
                title="Remaining generation credits"
              >
                <Zap size={12} className="text-accent" aria-hidden="true" />
                <span className="font-mono">{credits}</span>
                <span className="text-ink-400">credits</span>
              </Link>

              <button
                className="relative rounded-xl border border-ink-700 p-2 text-ink-200 hover:bg-ink-800"
                aria-label="Notifications"
              >
                <Bell size={17} />
              </button>

              <Link
                href="/settings"
                className="flex items-center gap-2 rounded-xl border border-ink-700 py-1.5 pl-1.5 pr-3 hover:bg-ink-800"
              >
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-xs font-bold text-white"
                  aria-hidden="true"
                >
                  {userName.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[7rem] truncate text-xs font-semibold text-ink-200 sm:inline">
                  {userName}
                </span>
              </Link>
            </div>
          </div>
        </header>

        <main id="main" className="px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
