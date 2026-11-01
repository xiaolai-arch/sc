import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { remindersFile } from '../../src/main/workspace/paths';

test('creates and updates global reminders in the vault', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-reminders-'));
  try {
    const service = createWorkspaceService(dir);
    const created = await service.createReminder?.({
      time: '21:30',
      label: '复盘'
    });
    expect(created).toMatchObject({ time: '21:30', label: '复盘', enabled: true });

    const reminders = await service.getReminders();
    expect(reminders.some((reminder) => reminder.id === created?.id)).toBe(true);

    const updated = await service.updateReminder?.({
      id: created!.id,
      time: '22:00',
      enabled: false
    });
    expect(updated).toMatchObject({
      id: created!.id,
      time: '22:00',
      label: '复盘',
      enabled: false
    });

    const raw = await readFile(remindersFile(dir), 'utf8');
    expect(raw).toContain('22:00');
    expect(raw).toContain('复盘');

    await expect(
      service.createReminder?.({ time: '25:00', label: '无效' })
    ).rejects.toThrow(/HH:MM/);
    await expect(
      service.updateReminder?.({ id: 'missing', label: '不存在' })
    ).rejects.toThrow(/not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
