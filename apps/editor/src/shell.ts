/** Static content of the P0 application shell. */
export interface ShellContent {
  readonly title: string;
  readonly subtitle: string;
  readonly status: string;
}

/**
 * Render the shell into a host element.
 *
 * Built with DOM APIs rather than an HTML string so that no untrusted value can
 * ever reach an `innerHTML` sink as the shell grows.
 */
export function renderShell(host: HTMLElement, content: ShellContent): void {
  host.replaceChildren(buildShell(content));
}

function buildShell(content: ShellContent): HTMLElement {
  const root = document.createElement('main');
  root.className = 'i3-shell';
  root.append(
    element('h1', 'i3-shell__title', content.title),
    element('p', 'i3-shell__subtitle', content.subtitle),
    statusBadge(content.status),
  );
  return root;
}

function statusBadge(text: string): HTMLElement {
  const badge = element('p', 'i3-shell__status', text);
  badge.setAttribute('role', 'status');
  badge.dataset['testid'] = 'shell-status';
  return badge;
}

function element(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
