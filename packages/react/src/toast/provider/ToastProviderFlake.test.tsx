/* eslint-disable vitest/expect-expect -- assertions live in `runFlakyTest` */
/**
 * Deterministic reproduction of the flaky `ToastProvider.test.tsx` test
 * "React.Activity > pauses the auto-dismiss timer while hidden and resumes it with the remaining
 * time once revealed" (https://github.com/mui/base-ui/issues/5884).
 *
 * The flake needs two things:
 * 1. The real Playwright pointer rests where the toast renders. Browser tests share one page, so
 *    the pointer stays wherever an earlier test that used `vitest/browser` input left it.
 * 2. A real browser frame passes while the toast is visible. The test runs on fake timers, so
 *    whether a frame slips in between its awaits depends on machine load.
 *
 * When both happen, Chromium hit-tests the stationary pointer after layout and dispatches a
 * trusted `mouseover`. The viewport's `onMouseEnter` pauses the timers, nothing ever un-hovers
 * it, and `onClose` is never called. The CI retry fails too because the pointer is still parked.
 */
import { expect, vi, describe, it } from 'vitest';
import * as React from 'react';
import { Toast } from '@base-ui/react/toast';
import { act, flushMicrotasks } from '@mui/internal-test-utils';
import { createRenderer, isJSDOM, resetBrowserPointer } from '#test-utils';
import type { ToastManager } from '../createToastManager';

// Captured before the fake clock is installed, so it waits for real browser frames.
const realSetTimeout = setTimeout;
function realWait(ms: number) {
  return new Promise((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

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
    <Toast.Root key={toast.id} toast={toast}>
      <Toast.Title />
    </Toast.Root>
  ));
}

/**
 * Leaves the real pointer at (x, y), the way an earlier browser test would. The toast in the test
 * below renders at roughly y = 20..48 (the `h2` margin pushes it down), so (5, 30) is over it.
 */
async function parkPointerAt(x: number, y: number) {
  const { userEvent } = await import('vitest/browser');
  const target = document.createElement('div');
  Object.assign(target.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: '1px',
    height: '1px',
  });
  document.body.appendChild(target);
  await userEvent.hover(target);
  target.remove();
}

async function realFrame() {
  await act(async () => {
    await realWait(50);
  });
}

describe.skipIf(isJSDOM)('ToastProvider React.Activity flake repro', () => {
  const { clock, render } = createRenderer();
  clock.withFakeTimers();

  /** Body of the flaky test, with hooks to let real frames pass at chosen points. */
  async function runFlakyTest(hooks: {
    whileVisible?: () => Promise<void>;
    afterReveal?: () => Promise<void>;
  }) {
    const onClose = vi.fn();
    const toastManager = Toast.createToastManager();
    const { setProps } = await render(<App visible toastManager={toastManager} />);

    await act(async () => {
      toastManager.add({ title: 'Toast', timeout: 1000, onClose });
    });
    await hooks.whileVisible?.();

    clock.tick(400);
    await setProps({ visible: false });

    clock.tick(5000);
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();

    await setProps({ visible: true });
    await hooks.afterReveal?.();

    clock.tick(599);
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();

    clock.tick(2);
    await flushMicrotasks();
    expect(onClose).toHaveBeenCalledTimes(1);
  }

  it('fails: pointer over the toast + a real frame after reveal', async () => {
    await parkPointerAt(5, 30);
    await runFlakyTest({ afterReveal: realFrame });
  });

  it('fails: pointer over the toast + a real frame before hiding', async () => {
    await parkPointerAt(5, 30);
    await runFlakyTest({ whileVisible: realFrame });
  });

  it('passes: pointer over the toast but no real frame (the usual CI outcome)', async () => {
    await parkPointerAt(5, 30);
    await runFlakyTest({});
  });

  it('passes: pointer away from the toast + real frames', async () => {
    await parkPointerAt(1, 1);
    await runFlakyTest({ whileVisible: realFrame, afterReveal: realFrame });
  });

  it('passes: resetBrowserPointer() first, then real frames', async () => {
    await parkPointerAt(5, 30);
    await resetBrowserPointer();
    await runFlakyTest({ whileVisible: realFrame, afterReveal: realFrame });
  });
});
