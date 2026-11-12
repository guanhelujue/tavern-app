/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: 'web' },
}));

import { completeAppFeedback, confirmAppAction, chooseAppAction, dismissAppNotice, showAppAlert, subscribeAppFeedback } from './app-alert';

describe('web app feedback queue', () => {
  beforeEach(() => {
    // Resolve any request left by a failed assertion before the next case.
    const unsubscribe = subscribeAppFeedback(() => undefined);
    unsubscribe();
  });

  it('fails closed without a mounted host', async () => {
    await expect(confirmAppAction('确认', '继续吗？')).resolves.toBe(false);
    await expect(chooseAppAction('选择', '下一步？', [{ id: 'continue', label: '继续' }])).resolves.toBeNull();
  });

  it('keeps notices queued until a host mounts', () => {
    showAppAlert('保存失败', '请重试。');
    let noticeCount = 0;
    const unsubscribe = subscribeAppFeedback((state) => { noticeCount = state.notices.length; });
    expect(noticeCount).toBe(1);
    unsubscribe();
  });

  it('resolves pending work safely when the host unmounts', async () => {
    const unsubscribe = subscribeAppFeedback(() => undefined);
    const pending = confirmAppAction('确认', '稍后处理');
    unsubscribe();
    await expect(pending).resolves.toBe(false);
  });

  it('queues confirm requests and resolves the active request only', async () => {
    const snapshots: string[] = [];
    const unsubscribe = subscribeAppFeedback((state) => snapshots.push(state.active?.id ?? 'none'));
    const first = confirmAppAction('一', '第一步');
    const second = confirmAppAction('二', '第二步');
    const current = snapshots.at(-1);
    expect(current).toMatch(/^confirm-/);
    completeAppFeedback(current!, true);
    expect(await first).toBe(true);
    expect(snapshots.at(-1)).toMatch(/^confirm-/);
    completeAppFeedback(snapshots.at(-1)!, null);
    expect(await second).toBe(false);
    unsubscribe();
  });

  it('resolves labelled action choices and stores notices for the host', async () => {
    let activeId = '';
    const unsubscribe = subscribeAppFeedback((state) => {
      activeId = state.active?.id ?? '';
      if (state.notices.some((notice) => notice.title === '已保存')) dismissAppNotice(state.notices[0]!.id);
    });
    const choice = chooseAppAction('导出成功', '请选择格式', [{ id: 'md', label: 'Markdown' }]);
    completeAppFeedback(activeId, 'md');
    expect(await choice).toBe('md');
    showAppAlert('已保存', '正文已保存。');
    showAppAlert('保存失败', '请重试。');
    unsubscribe();
  });

  it('ignores action ids that are not present in the active request', async () => {
    let activeId = '';
    const unsubscribe = subscribeAppFeedback((state) => { activeId = state.active?.id ?? ''; });
    let settled = false;
    const choice = chooseAppAction('导出', '选择格式', [{ id: 'md', label: 'Markdown' }]).then((value) => { settled = true; return value; });
    completeAppFeedback(activeId, 'invalid');
    await Promise.resolve();
    expect(settled).toBe(false);
    completeAppFeedback(activeId, 'md');
    await expect(choice).resolves.toBe('md');
    unsubscribe();
  });
});
