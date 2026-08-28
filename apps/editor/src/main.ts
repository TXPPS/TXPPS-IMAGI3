import './styles.css';
import { boot } from './boot.ts';
import { FAULT_PARAM } from './constants.ts';

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

async function start(): Promise<void> {
  await applyDevelopmentFaults();
  boot();
}

void start();
