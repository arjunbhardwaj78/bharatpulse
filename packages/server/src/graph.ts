import { haversineMeters, type Complaint } from '@bharatpulse/engine';
import type { City } from './data.js';
import type { StoredIncident } from './types.js';

export interface GraphNode { id: string; type: 'Incident' | 'Complaint' | 'Reporter' | 'Device' | 'Photo'; label: string }
export interface GraphEdge { from: string; to: string; type: 'FILED' | 'FROM_DEVICE' | 'HAS_PHOTO' | 'PART_OF' }
export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Devices used by more than 2 different reporters (across all history). These collapse into one source. */
  sharedDevices: { deviceId: string; reporters: number }[];
}
export interface Downstream { zone: string; hops: number; localities: string[] }

/** The incident's complaints as a graph. `all` is every complaint, used to count devices across incidents. */
export function buildSubgraph(incidentId: string, members: readonly Complaint[], all: readonly Complaint[]): Subgraph {
  const nodes = new Map<string, GraphNode>([[incidentId, { id: incidentId, type: 'Incident', label: incidentId }]]);
  const edges: GraphEdge[] = [];
  const node = (n: GraphNode): void => void nodes.set(n.id, n);
  for (const c of members) {
    node({ id: c.id, type: 'Complaint', label: c.issueType });
    node({ id: c.reporterId, type: 'Reporter', label: c.reporterId });
    edges.push({ from: c.reporterId, to: c.id, type: 'FILED' }, { from: c.id, to: incidentId, type: 'PART_OF' });
    if (c.deviceId) { node({ id: `dev:${c.deviceId}`, type: 'Device', label: c.deviceId }); edges.push({ from: c.id, to: `dev:${c.deviceId}`, type: 'FROM_DEVICE' }); }
    for (const h of c.photoHashes ?? []) { node({ id: `photo:${h}`, type: 'Photo', label: h.slice(0, 8) }); edges.push({ from: c.id, to: `photo:${h}`, type: 'HAS_PHOTO' }); }
  }
  const perDevice = new Map<string, Set<string>>();
  for (const c of all) if (c.deviceId) perDevice.set(c.deviceId, (perDevice.get(c.deviceId) ?? new Set()).add(c.reporterId));
  const sharedDevices = members
    .map((c) => c.deviceId)
    .filter((d, i, a): d is string => !!d && a.indexOf(d) === i && (perDevice.get(d)?.size ?? 0) > 2)
    .map((deviceId) => ({ deviceId, reporters: perDevice.get(deviceId)!.size }));
  return { nodes: [...nodes.values()], edges, sharedDevices };
}

/** Localities that lose water next if `zone` fails: follow FEEDS up to `hops` steps (breadth-first, shortest path wins). */
export function downstream(city: City, zone: string, hops: number): Downstream[] {
  const seen = new Map<string, number>([[zone, 0]]);
  let frontier = [zone];
  for (let h = 1; h <= hops; h++) {
    frontier = frontier.flatMap((z) => city.zones.find((x) => x.id === z)?.feeds ?? []).filter((z) => !seen.has(z));
    for (const z of frontier) seen.set(z, h);
  }
  return [...seen].filter(([, h]) => h > 0).map(([z, h]) => ({ zone: z, hops: h, localities: city.localities.filter((l) => l.zoneId === z).map((l) => l.id) }));
}

const WEEK = 7 * 24 * 3_600_000;

/** A road incident within 100 m of a leak that was first reported in the 7 days before it. */
export function findCause(road: StoredIncident, others: readonly StoredIncident[]): StoredIncident['possibleCause'] {
  if (road.incident.family !== 'ROAD') return undefined;
  const hit = others
    .filter((o) => o.incident.family === 'INFRASTRUCTURE' && o.incident.firstReportedAt <= road.incident.lastReportedAt && road.incident.firstReportedAt - o.incident.firstReportedAt <= WEEK)
    .map((o) => ({ o, d: haversineMeters(o.incident.centroid, road.incident.centroid) }))
    .filter(({ d }) => d <= 100)
    .sort((a, b) => a.d - b.d)[0];
  return hit && { incidentId: hit.o.incident.id, distanceM: Math.round(hit.d), confirmed: road.possibleCause?.incidentId === hit.o.incident.id ? road.possibleCause.confirmed : undefined };
}
