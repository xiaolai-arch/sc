import { useCallback, useEffect, useState } from 'react';
import { formatLocalDate } from '../shared/date';
import type { Bootstrap } from '../shared/ipc';
import { Onboarding } from './onboarding/Onboarding';
import { TodayPage } from './today/TodayPage';
import { Card } from './ui/Card';
import { Nav } from './ui/Nav';
import type { AppView } from './ui/Nav';
import { PageShell } from './ui/PageShell';

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<AppView>('today');

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

  return (
    <>
      <h1 className="sr-only">Study Coach</h1>
      {bootstrap === null ? (
        <PageShell>
          <div className="mx-auto max-w-[980px] px-6 py-20 text-gray-600">正在准备…</div>
        </PageShell>
      ) : bootstrap.needsOnboarding ? (
        <Onboarding
          showDemo={Boolean(window.studyCoachPrototype)}
          onComplete={() => {
            void refresh();
          }}
        />
      ) : (
        <PageShell>
          <Nav view={view} onChange={setView} />
          <main className="mx-auto max-w-[980px] px-6 py-12 md:px-8 md:py-20">
            {view === 'today' ? (
              <TodayPage
                hasApiKey={bootstrap.hasApiKey}
                onOpenSettings={() => setView('settings')}
              />
            ) : (
              <Card>
                <p className="text-gray-600">设置页即将到来。</p>
              </Card>
            )}
          </main>
        </PageShell>
      )}
    </>
  );
}
