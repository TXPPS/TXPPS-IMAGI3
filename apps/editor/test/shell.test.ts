import { beforeEach, describe, expect, it } from 'vitest';
import { renderShell } from '../src/shell.ts';

const CONTENT = { title: 'IMAGI3', subtitle: 'Subtitle text', status: 'Shell ready' };

describe('renderShell', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.append(host);
  });

  it('renders the title, subtitle and status', () => {
    renderShell(host, CONTENT);
    expect(host.querySelector('.i3-shell__title')?.textContent).toBe('IMAGI3');
    expect(host.querySelector('.i3-shell__subtitle')?.textContent).toBe('Subtitle text');
    expect(host.querySelector('[data-testid="shell-status"]')?.textContent).toBe('Shell ready');
  });

  it('exposes the status to assistive technology', () => {
    renderShell(host, CONTENT);
    expect(host.querySelector('[data-testid="shell-status"]')?.getAttribute('role')).toBe('status');
  });

  it('replaces previous content instead of appending', () => {
    renderShell(host, CONTENT);
    renderShell(host, { ...CONTENT, title: 'Second' });
    expect(host.querySelectorAll('.i3-shell')).toHaveLength(1);
    expect(host.querySelector('.i3-shell__title')?.textContent).toBe('Second');
  });

  it('never interprets content as markup', () => {
    renderShell(host, { ...CONTENT, title: '<img src=x onerror=alert(1)>' });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.i3-shell__title')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
