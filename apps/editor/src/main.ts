import './styles.css';
import { boot } from './boot.ts';
import { FAULT_PARAM } from './constants.ts';

async function applyDevelopmentFaults(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const kind = new URLSearchParams(window.location.search).get(FAULT_PARAM);
  if (kind === null) return;
  const { applyPlantedFault } = await import('./dev/plant.ts');
  applyPlantedFault(kind);
}

async function start(): Promise<void> {
  await applyDevelopmentFaults();
  boot();
}

void start();
