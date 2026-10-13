import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { levelFor, scoreSeverity } from '../src/severity.js';
import { NOW, fakeCluster } from './helpers.js';

const cfg = resolveConfig();

describe('scoreSeverity', () => {
  it('stays within 0..100 and the factors add up to the score', () => {
    const s = scoreSeverity(fakeCluster({ complaintCount: 500, radiusMeters: 9000, ageMin: 99_999, recent: 200 }), NOW, cfg);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.score).toBeGreaterThan(0);
    const sum = s.factors.reduce((t, f) => t + f.points, 0);
    expect(s.score).toBeCloseTo(sum, 1);
    for (const f of s.factors) expect(f.points).toBeLessThanOrEqual(f.max);
  });

  it('ranks more complaints higher', () => {
    const small = scoreSeverity(fakeCluster({ complaintCount: 3 }), NOW, cfg).score;
    const big = scoreSeverity(fakeCluster({ complaintCount: 20 }), NOW, cfg).score;
    expect(big).toBeGreaterThan(small);
  });

  it('ranks a still-growing incident above a stalled one of the same size', () => {
    const growing = scoreSeverity(fakeCluster({ complaintCount: 10, recent: 6 }), NOW, cfg).score;
    const stalled = scoreSeverity(fakeCluster({ complaintCount: 10, recent: 0 }), NOW, cfg).score;
    expect(growing).toBeGreaterThan(stalled);
  });

  it('gives longer-running incidents more duration points', () => {
    // Compare the duration factor alone: age also changes which reports count as "recent".
    const durationPoints = (ageMin: number): number =>
      scoreSeverity(fakeCluster({ ageMin }), NOW, cfg).factors.find((f) => f.name === 'duration')!.points;
    expect(durationPoints(600)).toBeGreaterThan(durationPoints(20));
    expect(durationPoints(100_000)).toBe(15); // capped at its maximum
  });

  it('weights health risk above supply above leaks', () => {
    const q = scoreSeverity(fakeCluster({ family: 'QUALITY' }), NOW, cfg).score;
    const s = scoreSeverity(fakeCluster({ family: 'SUPPLY' }), NOW, cfg).score;
    const i = scoreSeverity(fakeCluster({ family: 'INFRASTRUCTURE' }), NOW, cfg).score;
    expect(q).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(i);
  });

  it('maps scores to levels at the configured thresholds', () => {
    expect(levelFor(10, cfg)).toBe('LOW');
    expect(levelFor(35, cfg)).toBe('MEDIUM');
    expect(levelFor(55, cfg)).toBe('HIGH');
    expect(levelFor(75, cfg)).toBe('CRITICAL');
  });

  it('puts a small fresh cluster at LOW and a large, growing health risk at CRITICAL', () => {
    const small = scoreSeverity(fakeCluster({ complaintCount: 3, radiusMeters: 80, ageMin: 20 }), NOW, cfg);
    const severe = scoreSeverity(
      fakeCluster({ family: 'QUALITY', complaintCount: 30, radiusMeters: 800, ageMin: 720, recent: 8 }),
      NOW,
      cfg,
    );
    expect(small.level).toBe('LOW');
    expect(severe.level).toBe('CRITICAL');
  });
});
