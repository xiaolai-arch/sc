import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup } from '../src/main/backup';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import { createWorkspaceService } from '../src/main/workspace/create-workspace-service';
import {
  createIsolatedEnvironment,
  FRESH_MACHINE_MAIN_PATH,
  launchStudyCoach,
  type LaunchedStudyCoach,
  type IsolatedEnvironment
} from './support/launch';

/** Trailing 称呼 of the home greeting, from the same default the app ships. */
const GREETING_SUFFIX = new RegExp(`，${DEFAULT_DISPLAY_NAME}。$`);

/**
 * Walks every navigation destination and creates one record of each kind
 * through the real UI. The model layer stays offline: the workspace is created
 * through the exposed API and the remaining features are local-first.
 */
test.describe('ASAKI feature smoke', () => {
  test('all pages render and reminders, memories, reviews and topics persist', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await test.step('create a workspace through the API and reload', async () => {
        const workspaceId = await page.evaluate(async () => {
          const api = (window as unknown as { studyCoach: { createWorkspace: (input: unknown) => Promise<{ id: string }> } })
            .studyCoach;
          const workspace = await api.createWorkspace({
            name: '烟雾项目',
            kind: 'study',
            goal: '验证所有页面',
            description: 'e2e smoke'
          });
          return workspace.id;
        });
        expect(workspaceId).toBeTruthy();
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(GREETING_SUFFIX)).toBeVisible();
      });

      await test.step('every navigation destination renders', async () => {
        const nav = page.getByRole('navigation', { name: '主导航' });
        // The 今日 screen also links to 今日安排, so scope navigation clicks.
        await nav.getByRole('button', { name: '今日安排', exact: true }).click();
        await expect(page.locator('header').getByText('今日安排', { exact: true })).toBeVisible();
        await expect(page.getByText('今天还没有安排')).toBeVisible();

        await page.getByRole('button', { name: '长期计划', exact: true }).click();
        await expect(page.locator('header').getByText('长期计划', { exact: true })).toBeVisible();
        await expect(page.getByText('还没有长期计划。')).toBeVisible();

        await page.getByRole('button', { name: '日常', exact: true }).click();
        await expect(page.getByLabel('向阿咲提问')).toBeVisible();

        await page.getByRole('button', { name: '知识库', exact: true }).click();
        await expect(page.locator('header').getByText('知识库', { exact: true })).toBeVisible();
        await expect(page.getByText('还没有知识主题。').first()).toBeVisible();

        await page.getByRole('button', { name: '记忆', exact: true }).click();
        await expect(page.locator('header').getByText('记忆', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '新增记忆' })).toBeVisible();

        await page.getByRole('button', { name: '复盘', exact: true }).click();
        await expect(page.locator('header').getByText('复盘', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '补录复盘' })).toBeVisible();

        await page.getByRole('button', { name: '提醒', exact: true }).click();
        await expect(page.locator('header').getByText('提醒', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '添加提醒' })).toBeVisible();
      });

      await test.step('creates a reminder', async () => {
        await page.getByLabel('提醒内容').fill('喝水');
        await page.getByRole('button', { name: '添加提醒' }).click();
        await expect(page.getByRole('button', { name: '编辑提醒：喝水' })).toBeVisible();
      });

      await test.step('creates a memory', async () => {
        await page.getByRole('button', { name: '记忆', exact: true }).click();
        await page.getByRole('button', { name: '新增记忆' }).click();
        await page.getByLabel('新记忆内容').fill('偏好早上学习');
        await page.getByRole('button', { name: '保存新记忆' }).click();
        await expect(
          page.getByRole('button', { name: '编辑记忆：偏好早上学习' })
        ).toBeVisible();
      });

      await test.step('backfills a review', async () => {
        await page.getByRole('button', { name: '复盘', exact: true }).click();
        await page.getByRole('button', { name: '补录复盘' }).click();
        await page.getByLabel('完成', { exact: true }).fill('完成极限练习');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByText('完成极限练习')).toBeVisible();
      });

      await test.step('creates a knowledge topic', async () => {
        await page.getByRole('button', { name: '知识库', exact: true }).click();
        await page.getByRole('button', { name: '新增主题' }).click();
        await page.getByLabel('主题名称').fill('LangChain');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(
          page.locator('[aria-label="知识内容"]').getByText('在学', { exact: true })
        ).toBeVisible();
        // Below lg the topic opens in the note pane; go back to the list.
        await page.getByRole('button', { name: '返回目录' }).click();
        await expect(page.getByRole('button', { name: 'LangChain', exact: true })).toBeVisible();
      });

      await test.step('opens practice from the project page', async () => {
        await page.getByRole('button', { name: '日常', exact: true }).click();
        await page.getByRole('button', { name: '全部项目' }).click();
        await expect(page.locator('header').getByText('项目', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '练习', exact: true }).click();
        await expect(page.getByText('新建练习集')).toBeVisible();
        await page.getByRole('button', { name: '关闭练习' }).click();
      });

      await test.step('saves settings and addresses the user by name', async () => {
        await page.getByLabel('打开设置').click();
        await expect(page.getByText('保存设置')).toBeVisible();
        await page.getByLabel('称呼').fill('测试同学');
        await page.getByRole('button', { name: '保存设置' }).click();
        await expect(page.getByRole('status')).toHaveText('已保存');

        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(/，测试同学。$/)).toBeVisible();
      });

      await test.step('writes reminders, memory and review to the vault', async () => {
        const reminders = await import('node:fs/promises').then((fs) =>
          fs.readFile(`${environment.vault}/reminders.md`, 'utf8')
        );
        expect(reminders).toContain('喝水');
      });

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  /**
   * item 51 (spec 增补节，验收 28/29/34 的真实链路)：全新机器上装好 → 首启
   * 从备份恢复 → 完成引导前设置已采纳 → 重启后设置仍在、首启框不再出现。
   * The native directory picker and window.confirm are stubbed — the flow
   * itself runs through the real IPC, restore pipeline and restart.
   */
  test('a fresh machine restores from a backup inside the first-run dialog', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'study-coach-first-run-restore-e2e-'));
    try {
      // Build the backup with the real services so the restored vault is a
      // workspace the app actually lists, then add an adoptable state.json.
      const sourceVault = join(fixtureRoot, 'source-vault');
      const workspaceService = createWorkspaceService(sourceVault, { seed: false });
      await workspaceService.createWorkspace({
        name: '换机考研',
        kind: 'study',
        goal: '从旧电脑带来的项目',
        description: ''
      });
      const sourceUserData = join(fixtureRoot, 'source-user-data');
      await mkdir(sourceUserData, { recursive: true });
      const backup = await createBackup({
        vaultPath: sourceVault,
        userDataPath: sourceUserData,
        destinationRoot: join(fixtureRoot, 'exports'),
        now: () => new Date(2026, 10, 24, 9, 0, 0)
      });
      // The old machine's settings; vaultPath must never survive the adoption.
      await writeFile(
        join(backup.path, 'state.json'),
        JSON.stringify({
          onboarded: true,
          settings: {
            displayName: '换机同学',
            vaultPath: 'D:\\旧电脑\\StudyCoachVault',
            provider: { kind: 'local-cli', agent: 'codex', command: 'codex' },
            notifications: {
              enabled: true,
              morning: '08:00',
              evening: '21:30',
              weekly: '20:00',
              weeklyEnabled: true,
              behindSchedule: '20:30',
              behindScheduleEnabled: true,
              dndStart: '23:00',
              dndEnd: '07:30'
            },
            budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
            launchAtLogin: false
          }
        })
      );

      // A machine without state.json: the app opens on the first-run dialog.
      // Documents is redirected into the env so the fresh-install default
      // vault (which the restore swaps into) never touches the real one.
      const environment: IsolatedEnvironment = await createIsolatedEnvironment({
        freshMachine: true
      });
      const documentsDir = join(environment.root, 'documents');
      await mkdir(documentsDir, { recursive: true });
      const freshMachineLaunch = {
        entryPath: FRESH_MACHINE_MAIN_PATH,
        extraEnv: { STUDY_COACH_E2E_DOCUMENTS_DIR: documentsDir }
      };
      const first = await launchStudyCoach(environment, freshMachineLaunch);
      try {
        const { app, page } = first;
        await expect(page.getByText('欢迎使用阿咲')).toBeVisible({ timeout: 15_000 });

        // Stub the two native surfaces this flow needs: the main-process
        // directory picker and the renderer's confirm.
        await app.evaluate(
          ({ dialog }, backupPath: string) => {
            (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
              async () => ({ canceled: false, filePaths: [backupPath] });
          },
          backup.path
        );
        await page.evaluate(() => {
          (window as unknown as { confirm: (message?: string) => boolean }).confirm =
            () => true;
        });

        await page.getByRole('button', { name: '从备份恢复…' }).click();
        // Adopted: the restored-items line plus the settings-restored version.
        await expect(
          page.getByText('已恢复：项目、记录、设置。')
        ).toBeVisible({ timeout: 15_000 });
        await expect(
          page.getByText(
            '恢复会带回项目、记录、对话和用量；新机器上没有设置时，备份里的设置会一起还原，API Key 需要重新填写（它从未进入备份）。'
          )
        ).toBeVisible();

        // Close without creating a project; the adoption carried
        // onboarded:true, so the dialog is gone and the restored vault loads.
        await page.getByRole('button', { name: '稍后再说' }).click();
        await expect(page.getByText('欢迎使用阿咲')).toHaveCount(0);
        await expect(
          page.getByText('换机考研', { exact: true }).first()
        ).toBeVisible({ timeout: 15_000 });

        // 验收 29 前半句：同会话即生效——完成引导（此处是采纳带 onboarded:true
        // 后关闭）不重启，getSettings 返回已采纳值。getSettings 直接读 main
        // 进程的 settings 缓存；没有 handler 里的 reloadFromDisk 时，这里仍是
        // 默认缓存的 xiaolai（缓存一次后不再读盘，state.json 的采纳它看不见）。
        const inSessionSettings = await page.evaluate(async () => {
          const api = (
            window as unknown as {
              studyCoach: {
                getSettings: () => Promise<{ displayName: string; vaultPath: string }>;
              };
            }
          ).studyCoach;
          return api.getSettings();
        });
        expect(inSessionSettings.displayName).toBe('换机同学');
        expect(inSessionSettings.vaultPath).toBe(join(documentsDir, 'StudyCoachVault'));

        // The adopted settings sit in this machine's state.json with the local
        // vault path — the old machine's path must never survive.
        const { readFile: readState } = await import('node:fs/promises');
        const adoptedState = JSON.parse(
          await readState(join(environment.userData, 'state.json'), 'utf8')
        );
        expect(adoptedState.onboarded).toBe(true);
        expect(adoptedState.settings.displayName).toBe('换机同学');
        expect(adoptedState.settings.vaultPath).toBe(
          join(documentsDir, 'StudyCoachVault')
        );
      } finally {
        await first.app.close().catch(() => undefined);
      }

      // Restart on the same userData: settings restored, no first-run dialog.
      const second = await launchStudyCoach(environment, freshMachineLaunch);
      try {
        const { page } = second;
        await expect(page.getByText(/，换机同学。$/)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('欢迎使用阿咲')).toHaveCount(0);
        await expect(
          page.getByText('换机考研', { exact: true }).first()
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        await second.close();
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});