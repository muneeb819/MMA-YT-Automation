import Link from 'next/link';
import {
  ArrowRight, Check, Flame, PlayCircle, Sparkles, ShieldCheck, Zap, Layers, Gauge, Palette,
} from 'lucide-react';
import { Button, DemoBadge } from '@/components/ui';
import { FEATURES, FAQ, PIPELINE_STEPS, PRICING_TIERS, USE_CASES, OPTIMISATION_GOALS } from '@/lib/ui-copy';
import { MOCK_MODE } from '@/lib/config';

export const metadata = {
  title: 'ShortForge AI — Turn One Idea Into a Finished YouTube Short',
  description:
    'AI-powered scriptwriting, voiceovers, visuals, captions, SEO and video rendering — automated in one workflow.',
};

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8" aria-label="Main">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-gradient text-white">
              <Flame size={18} aria-hidden="true" />
            </span>
            <span className="text-base font-black tracking-tight text-white">ShortForge AI</span>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {['How it works', 'Features', 'Templates', 'Pricing', 'FAQ'].map((l) => (
              <a key={l} href={`#${l.toLowerCase().replace(/\s+/g, '-')}`} className="text-sm font-semibold text-ink-300 transition-colors hover:text-white">
                {l}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost hidden sm:inline-flex">Sign in</Link>
            <Link href="/login" className="btn-primary">Get started</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-16 pt-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 flex justify-center">
              {MOCK_MODE ? <DemoBadge /> : (
                <span className="chip border-accent/40 bg-accent/10 text-accent-soft">
                  <Sparkles size={12} aria-hidden="true" /> Live providers connected
                </span>
              )}
            </div>

            <h1 className="text-balance text-4xl font-black leading-[1.08] tracking-tight text-white sm:text-6xl">
              Turn One Idea Into a{' '}
              <span className="text-gradient">Finished YouTube Short</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-300 sm:text-lg">
              AI-powered scriptwriting, voiceovers, visuals, captions, SEO, and video rendering — automated in one workflow.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login" className="btn-primary w-full px-7 py-3.5 text-base sm:w-auto">
                Create Your First Short
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className="btn-secondary w-full px-7 py-3.5 text-base sm:w-auto">
                <PlayCircle size={17} aria-hidden="true" />
                Watch Demo
              </a>
            </div>

            <p className="mt-5 text-xs text-ink-500">
              No credit card required · Works with zero API keys in demo mode
            </p>
          </div>

          {/* Pipeline visual */}
          <div className="mt-16 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {PIPELINE_STEPS.map((s, i) => (
              <div key={s.step} className="panel panel-hover animate-fade-up p-4" style={{ animationDelay: `${i * 45}ms` }}>
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/20 text-[10px] font-black text-accent-soft">
                    {i + 1}
                  </span>
                  <h3 className="text-sm font-bold text-white">{s.step}</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Optimisation goals */}
      <section className="border-y border-ink-800 bg-ink-900/30 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              Optimised for measurable short-form craft
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-ink-400">
              These are optimisation goals the engine works toward. They are not predictions and not
              guarantees — no software can promise a view count.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {OPTIMISATION_GOALS.map((g) => (
              <div key={g.title} className="panel p-5">
                <h3 className="text-sm font-bold text-white">{g.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-400">{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">How it works</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-ink-400">
            One idea in, a finished 9:16 MP4 out — with progress you can watch the whole way.
          </p>

          <ol className="mt-10 space-y-3">
            {PIPELINE_STEPS.map((s, i) => (
              <li key={s.step} className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/15 font-black text-accent-soft">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-white">{s.step}</h3>
                  <p className="mt-0.5 text-sm text-ink-400">{s.body}</p>
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <span className="hidden text-ink-700 sm:block" aria-hidden="true">→</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-ink-800 bg-ink-900/30 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">Features</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="panel panel-hover p-5">
                <h3 className="text-sm font-bold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Templates */}
      <section id="templates" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">Templates</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-ink-400">
            Reusable narrative structures. Create your own at any time.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'Dark Documentary', beats: ['Hook', 'Historical context', 'Escalation', 'Key revelation', 'Ending'], icon: ShieldCheck },
              { name: 'Viral Fact', beats: ['Question', 'Unexpected fact', 'Explanation', 'Twist', 'CTA'], icon: Sparkles },
              { name: 'Business Story', beats: ['Problem', 'Person or company', 'Strategy', 'Result', 'Lesson'], icon: Layers },
              { name: 'AI News', beats: ['Breaking development', 'What happened', 'Why it matters', 'Impact'], icon: Zap },
              { name: 'Top 5', beats: ['Hook', '#5', '#4', '#3', '#2', '#1', 'CTA'], icon: Gauge },
              { name: 'Quick Explainer', beats: ['Hook', 'Misconception', 'Definition', 'Example', 'Summary'], icon: Palette },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.name} className="panel panel-hover p-5">
                  <Icon size={18} className="text-accent-soft" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-bold text-white">{t.name}</h3>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.beats.map((b) => (
                      <span key={b} className="chip text-[10px]">{b}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="border-y border-ink-800 bg-ink-900/30 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">Use cases</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((u) => (
              <div key={u.title} className="panel p-5">
                <h3 className="text-sm font-bold text-white">{u.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-400">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">Pricing</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-ink-400">
            Start free. Upgrade when you connect real providers and publish regularly.
          </p>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.id}
                className={`panel relative flex flex-col p-6 ${tier.highlight ? 'border-accent/50 shadow-2xl shadow-accent/10' : ''}`}
              >
                {tier.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-gradient px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                    Most popular
                  </span>
                )}
                <h3 className="text-sm font-bold uppercase tracking-wider text-ink-300">{tier.name}</h3>
                <p className="mt-3 text-4xl font-black tracking-tight text-white">{tier.priceLabel}</p>
                <p className="text-xs text-ink-500">{tier.period}</p>
                <p className="mt-4 text-sm text-ink-400">{tier.description}</p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-ink-300">
                      <Check size={15} className="mt-0.5 shrink-0 text-mint" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/login" className={`${tier.highlight ? 'btn-primary' : 'btn-secondary'} mt-6 w-full`}>
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-ink-800 bg-ink-900/30 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">FAQ</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="panel group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold text-white">
                  {f.q}
                  <span className="text-ink-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-ink-700 bg-panel-glow p-10 text-center">
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            Your next short is one sentence away
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-ink-300">
            Try the complete workflow right now — no API keys required.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="btn-primary w-full px-8 py-3.5 text-base sm:w-auto">
              Create Your First Short <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Button variant="secondary" className="w-full px-8 py-3.5 text-base sm:w-auto" disabled>
              Join the waitlist
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-800 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-gradient text-white">
              <Flame size={14} aria-hidden="true" />
            </span>
            <span className="text-sm font-black text-white">ShortForge AI</span>
            <span className="text-xs text-ink-500">— AI YouTube Shorts Automation Platform</span>
          </div>
          <p className="max-w-xl text-center text-[11px] leading-relaxed text-ink-500 sm:text-right">
            ShortForge optimises for short-form craft characteristics. It does not guarantee views,
            reach or virality. Always verify factual claims before publishing.
          </p>
        </div>
      </footer>
    </div>
  );
}
