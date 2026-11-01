import { useCallback, useEffect, useState } from 'react';
import { formatLocalDate } from '../shared/date';
import type { Bootstrap } from '../shared/ipc';
import { Workspace } from './shell/Workspace';
import { initTheme } from './theme';
import { PageShell } from './ui/PageShell';

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);

  const refresh = useCallback(async () => {
    const api = window.studyCoach;
    if (!api) {
      setBootstrap({ needsOnboarding: true, today: formatLocalDate(new Date()), hasApiKey: false });
      return;
    }
    try {
      setBootstrap(await api.getBootstrap());
    } catch {
      setBootstrap({ needsOnboarding: true, today: formatLocalDate(new Date()), hasApiKey: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => initTheme(), []);

  return (
    <>
      <h1 className="sr-only">Study Coach</h1>
      {bootstrap === null ? (
        <PageShell>
          <div className="mx-auto max-w-[980px] px-6 py-20 text-gray-500 dark:text-[#a1a1a6]">正在准备…</div>
        </PageShell>
      ) : (
        <Workspace
          hasApiKey={bootstrap.hasApiKey}
          onRefresh={() => {
            void refresh();
          }}
        />
      )}
    </>
  );
}
