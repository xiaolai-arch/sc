import type { AppSettings, ProviderConfig } from '../../shared/types';

export const DEFAULT_VAULT_DIRECTORY = 'StudyCoachVault';

export function defaultProvider(): ProviderConfig {
  return { kind: 'local-cli', agent: 'codex', command: 'codex' };
}

export function createDefaultSettings(vaultPath: string): AppSettings {
  return {
    vaultPath,
    provider: defaultProvider(),
    notifications: {
      enabled: true,
      morning: '08:00',
      evening: '21:30',
      weekly: '20:00',
      weeklyEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:30'
    },
    budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
    launchAtLogin: false
  };
}
