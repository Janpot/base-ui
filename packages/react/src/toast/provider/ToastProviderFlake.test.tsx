/**
 * Reproduction of the flaky `ToastProvider.test.tsx` test
 * "React.Activity > pauses the auto-dismiss timer while hidden and resumes it with the remaining
 * time once revealed" (https://github.com/mui/base-ui/issues/5884), using only APIs the existing
 * tests already use.
 *
 * The flake needs two things:
 * 1. The real Playwright pointer rests where the toast renders. Browser tests share one page, so
 *    the pointer stays wherever an earlier test that used `vitest/browser` input left it. Here an
 *    earlier test hovers a toast and doesn't call `resetBrowserPointer()`.
 * 2. A real browser frame passes while the toast is visible. The flaky test runs on fake timers,
 *    so whether a frame slips in between its awaits depends on machine load. Awaiting any
 *    `vitest/browser` command forces one, since it round-trips to the test server.
 *
 * When both happen, Chromium hit-tests the stationary pointer and dispatches a trusted `mouseover`.
 * The viewport's `onMouseEnter` pauses the timers, nothing un-hovers it, and `onClose` is never
 * called. The CI retry fails too because the pointer is still parked.
 */
/* eslint-disable vitest/expect-expect -- assertions live in `runFlakyTest` */
import { expect, vi, describe, it } from 'vitest';
import * as React from 'react';
import { Toast } from '@base-ui/react/toast';
import { act, flushMicrotasks, screen } from '@mui/internal-test-utils';
import { createRenderer, isJSDOM, resetBrowserPointer } from '#test-utils';
import type { ToastManager } from '../createToastManager';

const Activity = (
  React as typeof React & {
    Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }>;
  }
).Activity;

function App(props: { visible: boolean; toastManager: ToastManager }) {
  return (
    <Activity mode={props.visible ? 'visible' : 'hidden'}>
      <Toast.Provider toastManager={props.toastManager}>
        <Toast.Viewport data-testid="viewport">
          <ToastList />
        </Toast.Viewport>
      </Toast.Provider>
    </Activity>
  );
}

function ToastList() {
  return Toast.useToastManager().toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} data-testid="toast">
      <Toast.Title />
    </Toast.Root>
  ));
}

describe.skipIf(isJSDOM)('ToastProvider React.Activity flake repro', () => {
  const { clock, render } = createRenderer();
  clock.withFakeTimers();

  /** The flaky test's body, verbatim apart from the optional hook after adding the toast. */
  async function runFlakyTest(afterAdd?: () => Promise<void>) {
    const onClose = vi.fn();
    const toastManager = Toast.createToastManager();
    const { setProps } = await render(<App visible toastManager={toastManager} />);

    await act(async () => {
      toastManager.add({ title: 'Toast', timeout: 1000, onClose });
    });
    await afterAdd?.();

    clock.tick(400);
    await setProps({ visible: false });

    clock.tick(5000);
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();

    await setProps({ visible: true });

    clock.tick(599);
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();

    clock.tick(2);
    await flushMicrotasks();
    expect(onClose).toHaveBeenCalledTimes(1);
  }

  /** What an earlier browser test does: hover a toast for real and leave the pointer there. */
  async function leavePointerOnToast() {
    const { userEvent } = await import('vitest/browser');
    const toastManager = Toast.createToastManager();
    await render(<App visible toastManager={toastManager} />);
    await act(async () => {
      toastManager.add({ title: 'Toast' });
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      await userEvent.hover(screen.getByTestId('toast'));
    });
    expect(screen.getByTestId('viewport')).toHaveAttribute('data-expanded');
  }

  async function forceFrame() {
    const { userEvent } = await import('vitest/browser');
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      await userEvent.keyboard('{Shift}');
    });
  }

  describe('unmodified', () => {
    it('earlier test leaves the pointer on a toast', leavePointerOnToast);

    it('flaky test', async () => {
      await runFlakyTest();
    });
  });

  describe('browser command forces a frame', () => {
    it('earlier test leaves the pointer on a toast', leavePointerOnToast);

    it('flaky test', async () => {
      await runFlakyTest(forceFrame);
    });
  });

  describe('waiting for the trusted hover', () => {
    it('earlier test leaves the pointer on a toast', leavePointerOnToast);

    it('flaky test', async () => {
      await runFlakyTest(async () => {
        // `expect.poll` also advances the fake clock by its 50ms interval.
        await act(async () => {
          await expect.poll(() => screen.getByTestId('viewport')).toHaveAttribute('data-expanded');
        });
      });
    });
  });

  describe('control: resetBrowserPointer()', () => {
    it('earlier test leaves the pointer on a toast', leavePointerOnToast);

    it('flaky test', async () => {
      await resetBrowserPointer();
      await runFlakyTest(forceFrame);
    });
  });
});
