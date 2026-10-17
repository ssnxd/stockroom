import { AlertCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { OrderStatus } from '../api';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: LucideIcon;
  iconOnly?: boolean;
};

export function Button({ variant = 'secondary', icon: Icon, iconOnly, className = '', children, ...props }: ButtonProps) {
  const classes = [
    'button',
    `button-${variant}`,
    Icon && !iconOnly ? 'has-icon-start' : '',
    iconOnly ? 'icon-button' : '',
    className,
  ].join(' ');
  return (
    <button type="button" className={classes} {...props}>
      {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="card-header">
      <div>
        <h2 className="card-title">{title}</h2>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </header>
  );
}

const statusStyle: Record<OrderStatus, { label: string; tone: string }> = {
  paid: { label: 'Paid', tone: 'success' },
  partially_refunded: { label: 'Partially refunded', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const style = statusStyle[status] ?? { label: status, tone: 'neutral' };
  return <span className={`badge badge-${style.tone}`}>{style.label}</span>;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden />;
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="empty-state">
      <Icon size={24} strokeWidth={1.75} aria-hidden />
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="alert alert-danger" role="alert">
      <AlertCircle size={16} strokeWidth={1.75} aria-hidden />
      <span>{message}</span>
    </div>
  );
}
