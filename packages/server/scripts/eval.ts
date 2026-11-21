// npm run eval: how well does the trust layer catch fake campaigns, and does it leave real outages alone?
import { writeFileSync } from 'node:fs';
import { detectIncidents, type Complaint } from '@bharatpulse/engine';
import { SCENARIOS, genuineOutage, rng, type Opts } from '../src/scenarios.js';

const NOW = Date.UTC(2026, 10, 1, 12, 0);
const AT = { lat: 27.4924, lng: 77.6737 };
const opts = (seed: number, n: number, prefix: string): Opts => ({ n, at: AT, now: NOW, r: rng(seed), prefix });
const top = (cs: Complaint[], now = NOW) => detectIncidents(cs, now).incidents[0];
/** "Caught" = the incident would sit in Needs verification, or credibility is under 0.5. */
const caught = (cs: Complaint[]): boolean => {
  const i = top(cs);
  return !i || i.trust.needsVerification || i.trust.credibility < 0.5;
};

const KINDS = ['attack', 'simfarm', 'photo', 'sophisticated'] as const;
const RUNS = 5;
const report: Record<string, unknown> = { note: 'Synthetic data, fixed seeds. "sophisticated" is an attacker whose reports look human on every signal we check; it is expected to get through.' };

const fake: Record<string, { runs: number; caught: number }> = {};
for (const kind of KINDS) {
  let hit = 0;
  for (let k = 0; k < RUNS; k++) hit += caught(SCENARIOS[kind](opts(100 * k + 1, 20 + k * 10, `${kind}${k}-`))) ? 1 : 0;
  fake[kind] = { runs: RUNS, caught: hit };
}
const naive = KINDS.filter((k) => k !== 'sophisticated');
report.fakeCampaigns = fake;
report.detectionRateExcludingSophisticated = naive.reduce((s, k) => s + fake[k].caught, 0) / (naive.length * RUNS);

let falsePositives = 0;
const minutesToFlag: number[] = [];
const GENUINE = 10;
for (let k = 0; k < GENUINE; k++) {
  const n = 12 + k * 5;
  const all = genuineOutage({ ...opts(500 + k, n, `real${k}-`), minutes: 60 });
  if (caught(all)) falsePositives++;
  // first minute at which the incident is MEDIUM or worse and trusted
  const start = Math.min(...all.map((c) => c.createdAt));
  for (let m = 0; m <= 90; m++) {
    const at = start + m * 60_000;
    const i = top(all.filter((c) => c.createdAt <= at), at);
    if (i && !i.trust.needsVerification && i.severity.level !== 'LOW') { minutesToFlag.push(m); break; }
  }
}
report.genuineOutages = { runs: GENUINE, falselyFlagged: falsePositives, falsePositiveRate: falsePositives / GENUINE, flaggedAtAll: minutesToFlag.length, medianMinutesFromFirstReportToFlag: minutesToFlag.sort((a, b) => a - b)[Math.floor(minutesToFlag.length / 2)] ?? null };

console.log(JSON.stringify(report, null, 2));
writeFileSync(new URL('../eval-results.json', import.meta.url), JSON.stringify(report, null, 2));
