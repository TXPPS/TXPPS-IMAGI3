import { APP_ROOT_ID, READY_ATTRIBUTE, READY_MARK } from './constants.ts';
import { renderShell } from './shell.ts';

const SHELL_CONTENT = {
  title: 'IMAGI3',
  subtitle:
    'Cross-device game engine. Phase 0 foundation: build, test and audit harness only — ' +
    'no editor surface yet.',
  status: 'Shell ready',
} as const;

export class BootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootError';
  }
}

function requireRoot(): HTMLElement {
  const root = document.getElementById(APP_ROOT_ID);
  if (root === null) throw new BootError(`missing #${APP_ROOT_ID} mount point`);
  return root;
}

/**
 * Render the shell and publish the readiness signal that E2E and the cold-load
 * budget harness synchronise on.
 */
export function boot(): void {
  renderShell(requireRoot(), SHELL_CONTENT);
  performance.mark(READY_MARK);
  document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
}

export { SHELL_CONTENT };
