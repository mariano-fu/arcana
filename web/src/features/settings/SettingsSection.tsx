import { useId, type ReactNode } from 'react';

/** One titled block of Ajustes. Sections stack, so later tasks (T3.8 sync) just add one. */
export default function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
