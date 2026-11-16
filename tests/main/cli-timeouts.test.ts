import { afterEach, expect, test, vi } from 'vitest';
import { createCliWatchdog } from '../../src/main/agent/cli-agent-client';
import type { ModelTimeoutError } from '../../src/main/agent/model-client';

function watchdogWith(windows: {
  timeoutMs: number;
  startupTimeoutMs?: number;
  idleTimeoutMs?: number;
}) {
  const errors: ModelTimeoutError[] = [];
  const watchdog = createCliWatchdog(windows, (error) => errors.push(error));
  return { watchdog, errors };
}

afterEach(() => {
  vi.useRealTimers();
});

test('a CLI that never answers reports a startup timeout, not a generic one', () => {
  vi.useFakeTimers();
  const { errors } = watchdogWith({
    timeoutMs: 10 * 60_000,
    startupTimeoutMs: 30_000,
    idleTimeoutMs: 60_000
  });

  vi.advanceTimersByTime(29_999);
  expect(errors).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.name).toBe('ModelTimeoutError');
  expect(errors[0]?.message).toContain('启动超时');
  expect(errors[0]?.message).not.toContain('无活动超时');
});

test('continuous output keeps resetting the idle clock', () => {
  vi.useFakeTimers();
  const { watchdog, errors } = watchdogWith({
    timeoutMs: 60 * 60_000,
    startupTimeoutMs: 30_000,
    idleTimeoutMs: 60_000
  });
  // Ten minutes of activity in 50-second steps: the 60-second idle window is
  // never reached, so a long answer must not be treated as stalled.
  watchdog.touch();
  for (let step = 0; step < 12; step += 1) {
    vi.advanceTimersByTime(50_000);
    watchdog.touch();
  }
  expect(errors).toHaveLength(0);

  vi.advanceTimersByTime(60_001);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toContain('无活动超时');
});

test('the total ceiling still applies to a process that keeps talking', () => {
  vi.useFakeTimers();
  const { watchdog, errors } = watchdogWith({
    timeoutMs: 120_000,
    startupTimeoutMs: 60_000,
    idleTimeoutMs: 60_000
  });

  watchdog.touch();
  for (let elapsed = 0; elapsed < 120_000; elapsed += 30_000) {
    vi.advanceTimersByTime(30_000);
    watchdog.touch();
  }
  vi.advanceTimersByTime(1);

  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toContain('总时长上限');
});

test('stop clears every pending clock', () => {
  vi.useFakeTimers();
  const { watchdog, errors } = watchdogWith({
    timeoutMs: 120_000,
    startupTimeoutMs: 30_000,
    idleTimeoutMs: 60_000
  });
  watchdog.touch();
  watchdog.stop();
  vi.advanceTimersByTime(3_600_000);
  expect(errors).toHaveLength(0);
});

test('the startup window never exceeds the total ceiling', () => {
  vi.useFakeTimers();
  const { errors } = watchdogWith({
    timeoutMs: 20_000,
    startupTimeoutMs: 60_000,
    idleTimeoutMs: 60_000
  });
  vi.advanceTimersByTime(20_000);
  expect(errors.some((error) => error.message.includes('总时长上限'))).toBe(true);
});
