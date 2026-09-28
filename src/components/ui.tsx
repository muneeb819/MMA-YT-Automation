'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: '',
  lg: 'px-6 py-3.5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
  style,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
  style?: React.CSSProperties;
}) {
  return (
    <Tag className={`panel p-5 ${className}`} style={style}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-ink-100">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-1 text-accent" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-ink-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs font-medium text-ember">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`input ${className}`} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`input resize-y leading-relaxed ${className}`} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...rest }, ref) {
    return (
      <select ref={ref} className={`input cursor-pointer ${className}`} {...rest}>
        {children}
      </select>
    );
  },
);

/* -------------------------------------------------------------------------- */
/* Option picker — keyboard accessible radio group styled as selectable cards */
/* -------------------------------------------------------------------------- */

export interface Option {
  value: string;
  label: string;
  description?: string;
}

export function OptionGroup({
  name,
  value,
  onChange,
  options,
  columns = 2,
  legend,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  columns?: 2 | 3 | 4;
  legend: string;
}) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];

  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className={`grid grid-cols-1 gap-2 ${cols}`}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={`group relative flex cursor-pointer flex-col rounded-xl border p-3 transition-all ${
                selected
                  ? 'border-accent bg-accent/10 shadow-lg shadow-accent/10'
                  : 'border-ink-700 bg-ink-900/50 hover:border-ink-600 hover:bg-ink-800/60'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span
                className={`text-sm font-semibold ${selected ? 'text-white' : 'text-ink-200'}`}
              >
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 text-[11px] leading-snug text-ink-400">{option.description}</span>
              )}
              {selected && (
                <span
                  className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent"
                  aria-hidden="true"
                />
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<string, string> = {
  COMPLETED: 'border-mint/40 bg-mint/10 text-mint',
  FAILED: 'border-ember/40 bg-ember/10 text-ember',
  CANCELLED: 'border-ink-600 bg-ink-800 text-ink-300',
  DRAFT: 'border-ink-600 bg-ink-800 text-ink-300',
  QUEUED: 'border-accent/40 bg-accent/10 text-accent-soft',
};

const IN_PROGRESS = new Set([
  'RESEARCHING', 'SCRIPTING', 'SEO_GENERATING', 'SCENE_PLANNING',
  'GENERATING_VISUALS', 'GENERATING_VOICE', 'GENERATING_CAPTIONS',
  'ASSEMBLING', 'RENDERING', 'QUALITY_CHECK',
]);

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').toLowerCase();
  const tone =
    STATUS_TONE[status] ??
    (IN_PROGRESS.has(status) ? 'border-accent/50 bg-accent/10 text-accent-soft' : 'border-ink-600 bg-ink-800 text-ink-300');
  const animated = IN_PROGRESS.has(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${tone}`}
    >
      {animated && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-current" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback states                                                             */
/* -------------------------------------------------------------------------- */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-400" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-500">{icon}</div>}
      <h3 className="text-base font-bold text-ink-100">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-ember/40 bg-ember/5 p-5 text-center">
      <p className="text-sm font-semibold text-ember">Something went wrong</p>
      <p className="mt-1 text-sm text-ink-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Demo-mode badge — makes mock output impossible to mistake for real AI output */
/* -------------------------------------------------------------------------- */

export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300"
      title="Demo mode: content and media are synthetic. Real providers are not connected."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
      {compact ? 'Demo' : 'Demo / Mock Mode'}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex justify-between text-xs text-ink-400">
          <span>{label}</span>
          <span className="font-mono">{Math.round(clamped)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800"
      >
        <div
          className="h-full rounded-full bg-accent-gradient transition-all duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'default',
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'danger' | 'muted';
  hint?: string;
}) {
  const tones = {
    default: 'text-ink-100',
    accent: 'text-accent-soft',
    success: 'text-mint',
    danger: 'text-ember',
    muted: 'text-ink-300',
  } as const;

  return (
    <div className="panel panel-hover p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
        {icon && <span className="text-ink-500">{icon}</span>}
      </div>
      <p className={`mt-3 text-3xl font-black tracking-tight ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
