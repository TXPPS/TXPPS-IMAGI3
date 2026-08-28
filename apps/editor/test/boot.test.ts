import { beforeEach, describe, expect, it } from 'vitest';
import { BootError, boot } from '../src/boot.ts';
import { APP_ROOT_ID, READY_ATTRIBUTE, READY_MARK } from '../src/constants.ts';

function mountRoot(): void {
  const root = document.createElement('div');
  root.id = APP_ROOT_ID;
  document.body.append(root);
}

describe('boot', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute(READY_ATTRIBUTE);
    performance.clearMarks();
  });

  it('renders the shell into the declared mount point', () => {
    mountRoot();
    boot();
    expect(document.querySelector(`#${APP_ROOT_ID} .i3-shell`)).not.toBeNull();
  });

  it('publishes the readiness attribute the E2E harness waits on', () => {
    mountRoot();
    boot();
    expect(document.documentElement.getAttribute(READY_ATTRIBUTE)).toBe('true');
  });

  it('emits the performance mark the cold-load budget is measured from', () => {
    mountRoot();
    boot();
    expect(performance.getEntriesByName(READY_MARK)).toHaveLength(1);
  });

  it('fails loudly when the mount point is missing', () => {
    expect(() => {
      boot();
    }).toThrow(BootError);
  });
});
