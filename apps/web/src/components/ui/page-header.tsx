import type { ReactNode } from 'react';

export function PageHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="mt-1 text-primary" aria-hidden>
            {icon}
          </div>
        ) : null}
        <div>
          <h1 className="font-display text-3xl leading-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
