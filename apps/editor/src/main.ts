import './styles.css';
import { boot } from './boot.ts';
import { APP_ROOT_ID, FAULT_PARAM } from './constants.ts';
import { ENTITY_COUNT_PARAM, PLAY_PARAM, REFERENCE_2D } from './playmode/params.ts';

async function applyDevelopmentFaults(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const params = new URLSearchParams(window.location.search);
  const kind = params.get(FAULT_PARAM);
  if (kind === null) return;
  const { applyPlantedFault, FAULT_ITERATIONS_PARAM } = await import('./dev/plant.ts');
  const rawIterations = params.get(FAULT_ITERATIONS_PARAM);
  const iterations = rawIterations === null ? undefined : Number.parseInt(rawIterations, 10);
  applyPlantedFault(kind, {
    iterations: iterations !== undefined && Number.isFinite(iterations) ? iterations : undefined,
  });
}

/**
 * Play mode is loaded on demand.
 *
 * The chunk pulls in the runtime and three.js, and the editor shell must not
 * pay for either before someone presses play — the cold-load budget is stated
 * against the shell, and a renderer in the entry chunk would be a regression
 * measured on every device profile for a feature most sessions never reach.
 */
async function startPlayModeIfRequested(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (params.get(PLAY_PARAM) !== REFERENCE_2D) return false;

  const root = document.getElementById(APP_ROOT_ID);
  if (root === null) return false;
  const { startPlayMode } = await import('./playmode/index.ts');
  const requested = Number.parseInt(params.get(ENTITY_COUNT_PARAM) ?? '', 10);
  startPlayMode(root, Number.isFinite(requested) && requested > 0 ? requested : undefined);
  return true;
}

async function start(): Promise<void> {
  await applyDevelopmentFaults();
  boot();
  await startPlayModeIfRequested();
}

void start();
