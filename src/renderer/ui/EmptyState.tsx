import type { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm md:p-12">
      <h2 className="text-xl font-semibold tracking-tight text-black">{title}</h2>
      {description ? <p className="mt-2 text-gray-600">{description}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
