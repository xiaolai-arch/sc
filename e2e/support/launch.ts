import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const PROJECT_ROOT = resolve(__dirname, '..', '..');
export const FAKE_CLI_PATH = join(PROJECT_ROOT, 'e2e', 'fixtures', 'fake-codex.mjs');

export type IsolatedEnvironment = {
  root: string;
  userData: string;
  vault: string;
  cleanup(): Promise<void>;
};

/**
 * Creates a throwaway userData directory and vault. The pre-seeded state keeps
 * the local CLI provider pointed at the fake fixture, so onboarding cannot
 * switch the app to a real CLI or a network-backed model.
 */
export async function createIsolatedEnvironment(): Promise<IsolatedEnvironment> {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-e2e-'));
  const userData = join(root, 'user-data');
  const vault = join(root, 'vault');
  await mkdir(userData, { recursive: true });
  await chmod(FAKE_CLI_PATH, 0o755);
  await writeFile(
    join(userData, 'state.json'),
    `${JSON.stringify(
      {
        onboarded: false,
        settings: {
          vaultPath: vault,
          provider: { kind: 'local-cli', agent: 'codex', command: FAKE_CLI_PATH }
        }
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );

  return {
    root,
    userData,
    vault,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

/** Environment for the app process; credentials are deliberately stripped. */
function childEnvironment(userData: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'ELECTRON_RUN_AS_NODE') continue;
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    STUDY_COACH_USER_DATA_DIR: userData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
}

export type LaunchedStudyCoach = {
  app: ElectronApplication;
  page: Page;
  environment: IsolatedEnvironment;
  close(): Promise<void>;
};

export async function launchStudyCoach(): Promise<LaunchedStudyCoach> {
  const environment = await createIsolatedEnvironment();
  const linuxFlags = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
  const app = await electron.launch({
    args: [...linuxFlags, PROJECT_ROOT],
    cwd: PROJECT_ROOT,
    env: childEnvironment(environment.userData),
    timeout: 60_000
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    environment,
    async close() {
      await app.close().catch(() => undefined);
      await environment.cleanup();
    }
  };
}
