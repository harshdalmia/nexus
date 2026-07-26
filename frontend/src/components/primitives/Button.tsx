import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'quiet' | 'ghost' | 'danger';
type Size = 'xs' | 'sm';

const variants: Record<Variant, string> = {
  primary: 'ctl-primary',
  quiet: '',
  ghost: 'ctl-ghost',
  danger: 'ctl-danger',
};

/* size only changes height and horizontal padding — never type size, so a
   dense toolbar and a prominent action still read as the same family.
   `xs` was a 21px target, which is below any sane minimum for a control that
   commits an action; it is now 28px with real gutters. */
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-meta gap-1.5',
  sm: 'px-3.5 text-xs2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly children: ReactNode;
}

export const Button = ({
  variant = 'quiet',
  size = 'sm',
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button type={type} className={`ctl ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
    {children}
  </button>
);

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly children: ReactNode;
  readonly active?: boolean;
}

export const IconButton = ({
  label,
  children,
  active = false,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) => (
  <button
    type={type}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={`ctl aspect-square px-0 ${active ? 'ctl-primary' : 'ctl-ghost'} ${className}`}
    style={{ width: 'var(--control-h)' }}
    {...rest}
  >
    {children}
  </button>
);

/* keycaps: printed, slightly recessed, mono */
export const Kbd = ({ children }: { readonly children: ReactNode }) => (
  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] border border-rule bg-sunken px-1.5 text-meta leading-none font-medium text-faint shadow-[inset_0_-1px_0_0_var(--s-rule)]">
    {children}
  </kbd>
);
