import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptQueue } from '../src/platform/script-queue.js';

afterEach(() => vi.useRealTimers());
describe('ScriptQueue deadlines', () => {
  it('never executes a queued script whose deadline expired', async () => {
    vi.useFakeTimers();
    const q = new ScriptQueue();
    let finish!: (value: string) => void;
    const first = q.execute(() => new Promise<string>(r => { finish = r; }), 1000);
    const run = vi.fn(async () => 'second');
    const second = q.execute(run, 10).catch(e => e.message);
    await vi.advanceTimersByTimeAsync(11);
    expect(await second).toContain('not executed');
    finish('first');
    await first;
    await vi.advanceTimersByTimeAsync(1);
    expect(run).not.toHaveBeenCalled();
  });
  it('quarantines the queue after an active timeout even when the old script completes later', async () => {
    vi.useFakeTimers();
    const q = new ScriptQueue();
    let finish!: () => void;
    const first = q.execute(() => new Promise<void>(r => { finish = r; }), 10).catch(e => e.message);
    const run = vi.fn(async () => 1);
    const second = q.execute(run, 1000).catch(e => e.message);
    await vi.advanceTimersByTimeAsync(11);
    expect(await first).toContain('outcome uncertain');
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toContain('not executed');
    expect(run).not.toHaveBeenCalled();
  });
  it('continues after a definite ordinary failure, with a reduced time budget', async () => {
    const q = new ScriptQueue();
    await expect(q.execute(async () => { throw new Error('invalid script'); }, 1000)).rejects.toThrow('invalid script');
    await expect(q.execute(async remaining => remaining > 0 && remaining <= 1000, 1000)).resolves.toBe(true);
  });
});
