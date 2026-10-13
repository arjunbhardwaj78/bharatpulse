import type { IssueFamily } from './types.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Maximum points each severity factor can contribute. They sum to 100. */
export const SEVERITY_MAX = { volume: 35, spread: 15, velocity: 20, duration: 15, family: 15 } as const;

export interface EngineConfig {
  /** Two complaints are "near" each other if within this many metres. */
  epsMeters: number;
  /** ...and "close in time" if reported within this many milliseconds. */
  timeWindowMs: number;
  /** Minimum complaints (after de-duplication) before a cluster becomes an incident. */
  minComplaints: number;
  /** Repeat complaints from one reporter inside this window count once. */
  reporterDedupeWindowMs: number;
  /** "Recent" complaints, for the velocity factor, are those within this window of now. */
  velocityWindowMs: number;
  /** Complaint count at which the volume factor is maxed out. */
  volumeCap: number;
  /** Cluster radius (m) at which the spread factor is maxed out. */
  spreadCapMeters: number;
  /** Recent-complaint count at which the velocity factor is maxed out. */
  velocityCap: number;
  /** Incident age at which the duration factor is maxed out. */
  durationCapMs: number;
  /** Score cut-offs (0 to 100) for each level. Below `medium` is LOW. */
  levelThresholds: { medium: number; high: number; critical: number };
  /** Points added by issue family: health risks outrank leaks. Max 15 each. */
  familyWeight: Record<IssueFamily, number>;
}

export const DEFAULT_CONFIG: EngineConfig = {
  epsMeters: 500,
  timeWindowMs: 3 * HOUR,
  minComplaints: 3,
  reporterDedupeWindowMs: 30 * MINUTE,
  velocityWindowMs: 30 * MINUTE,
  volumeCap: 30,
  spreadCapMeters: 800,
  velocityCap: 8,
  durationCapMs: 12 * HOUR,
  levelThresholds: { medium: 35, high: 55, critical: 75 },
  familyWeight: { QUALITY: 15, SUPPLY: 10, INFRASTRUCTURE: 6 },
};

export type ConfigOverrides = Partial<Omit<EngineConfig, 'levelThresholds' | 'familyWeight'>> & {
  levelThresholds?: Partial<EngineConfig['levelThresholds']>;
  familyWeight?: Partial<EngineConfig['familyWeight']>;
};

/** Merge overrides onto the defaults and reject nonsense values early. */
export function resolveConfig(overrides: ConfigOverrides = {}): EngineConfig {
  const cfg: EngineConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    levelThresholds: { ...DEFAULT_CONFIG.levelThresholds, ...overrides.levelThresholds },
    familyWeight: { ...DEFAULT_CONFIG.familyWeight, ...overrides.familyWeight },
  };

  const positive = [
    'epsMeters',
    'timeWindowMs',
    'reporterDedupeWindowMs',
    'velocityWindowMs',
    'volumeCap',
    'spreadCapMeters',
    'velocityCap',
    'durationCapMs',
  ] as const;
  for (const key of positive) {
    const value = cfg[key];
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Config "${key}" must be a positive number`);
  }
  if (!Number.isInteger(cfg.minComplaints) || cfg.minComplaints < 2) {
    throw new Error('Config "minComplaints" must be an integer of at least 2');
  }
  const { medium, high, critical } = cfg.levelThresholds;
  if (!(0 < medium && medium < high && high < critical && critical <= 100)) {
    throw new Error('Config "levelThresholds" must satisfy 0 < medium < high < critical <= 100');
  }
  for (const [family, weight] of Object.entries(cfg.familyWeight)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > SEVERITY_MAX.family) {
      throw new Error(`Config "familyWeight.${family}" must be between 0 and ${SEVERITY_MAX.family}`);
    }
  }
  return cfg;
}
