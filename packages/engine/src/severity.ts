import { SEVERITY_MAX, type EngineConfig } from './config.js';
import type { Cluster, IssueFamily, Severity, SeverityFactor, SeverityLevel } from './types.js';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const FAMILY_LABEL: Record<IssueFamily, string> = {
  SUPPLY: 'supply failure',
  QUALITY: 'water-quality (health) risk',
  INFRASTRUCTURE: 'infrastructure leak',
};

/**
 * Transparent 0-100 score. Five factors, each with a fixed maximum, so the
 * officer can see exactly why an incident ranks where it does:
 *   volume   (35)  how many households report it, on a log scale
 *   velocity (20)  how many reports arrived in the last window (still growing?)
 *   spread   (15)  how wide an area is affected
 *   duration (15)  how long it has been going on
 *   issue type (15) health risks outrank leaks
 * Log scale for volume: the 3rd complaint matters far more than the 30th.
 */
export function scoreSeverity(cluster: Cluster, now: number, cfg: EngineConfig): Severity {
  const volume = SEVERITY_MAX.volume * clamp01(Math.log1p(cluster.complaintCount) / Math.log1p(cfg.volumeCap));

  const recent = cluster.reportedAt.filter((t) => t <= now && now - t <= cfg.velocityWindowMs).length;
  const velocity = SEVERITY_MAX.velocity * clamp01(recent / cfg.velocityCap);

  const spread = SEVERITY_MAX.spread * clamp01(cluster.radiusMeters / cfg.spreadCapMeters);

  const ageMs = Math.max(0, now - cluster.firstReportedAt);
  const duration = SEVERITY_MAX.duration * clamp01(ageMs / cfg.durationCapMs);

  const family = Math.min(SEVERITY_MAX.family, cfg.familyWeight[cluster.family]);

  const minutes = Math.round(cfg.velocityWindowMs / 60_000);
  const factors: SeverityFactor[] = [
    {
      name: 'volume',
      points: round1(volume),
      max: SEVERITY_MAX.volume,
      detail: `${cluster.complaintCount} households reporting`,
    },
    {
      name: 'velocity',
      points: round1(velocity),
      max: SEVERITY_MAX.velocity,
      detail: `${recent} new reports in the last ${minutes} min`,
    },
    {
      name: 'spread',
      points: round1(spread),
      max: SEVERITY_MAX.spread,
      detail: `affects an area about ${Math.round(cluster.radiusMeters)} m wide from the centre`,
    },
    {
      name: 'duration',
      points: round1(duration),
      max: SEVERITY_MAX.duration,
      detail: `ongoing for ${round1(ageMs / 3_600_000)} h`,
    },
    {
      name: 'issue type',
      points: round1(family),
      max: SEVERITY_MAX.family,
      detail: FAMILY_LABEL[cluster.family],
    },
  ];

  const score = round1(factors.reduce((sum, f) => sum + f.points, 0));
  return { score, level: levelFor(score, cfg), factors };
}

export function levelFor(score: number, cfg: EngineConfig): SeverityLevel {
  const t = cfg.levelThresholds;
  if (score >= t.critical) return 'CRITICAL';
  if (score >= t.high) return 'HIGH';
  if (score >= t.medium) return 'MEDIUM';
  return 'LOW';
}
