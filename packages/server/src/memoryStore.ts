import type { Complaint } from '@bharatpulse/engine';
import { CITY, type City } from './data.js';
import { buildSubgraph, downstream, type Downstream, type Subgraph } from './graph.js';
import type { IncidentStore } from './store.js';
import type { Checkin, Notice } from './types.js';
import type { StoredIncident } from './types.js';

/**
 * Keeps everything in RAM. Used for tests and the no-setup demo; data is lost
 * on restart. Returns copies so a caller can never change stored data by accident.
 */
export class MemoryStore implements IncidentStore {
  private complaints = new Map<string, Complaint>();
  private incidents = new Map<string, StoredIncident>();
  private confirmed = new Set<string>();
  private checkins = new Map<string, Checkin>();
  private notices = new Map<string, Notice>();

  constructor(private readonly city: City = CITY) {}

  async addComplaint(complaint: Complaint): Promise<void> {
    if (this.complaints.has(complaint.id)) throw new Error(`complaint ${complaint.id} already exists`);
    this.complaints.set(complaint.id, structuredClone(complaint));
  }

  async complaintsSince(since: number): Promise<Complaint[]> {
    return [...this.complaints.values()]
      .filter((c) => c.createdAt >= since)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((c) => structuredClone(c));
  }

  async listIncidents(): Promise<StoredIncident[]> {
    return [...this.incidents.values()].map((s) => structuredClone(s));
  }

  async getIncident(id: string): Promise<StoredIncident | undefined> {
    const found = this.incidents.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async saveIncidents(records: readonly StoredIncident[]): Promise<void> {
    for (const r of records) this.incidents.set(r.incident.id, structuredClone(r));
  }

  async clear(): Promise<void> {
    this.complaints.clear();
    this.incidents.clear();
    this.confirmed.clear();
    this.checkins.clear();
    this.notices.clear();
  }

  async addCheckin(c: Checkin): Promise<void> {
    this.checkins.set(c.id, c);
  }

  async checkinsSince(since: number): Promise<Checkin[]> {
    return [...this.checkins.values()].filter((c) => c.at >= since).sort((a, b) => a.at - b.at);
  }

  async saveNotice(n: Notice): Promise<void> {
    this.notices.set(n.id, n);
  }

  async listNotices(): Promise<Notice[]> {
    return [...this.notices.values()].sort((a, b) => a.startsAt - b.startsAt);
  }

  async deleteNotice(id: string): Promise<boolean> {
    return this.notices.delete(id);
  }

  async confirm(reporterId: string, incidentId: string): Promise<boolean> {
    const key = `${reporterId}|${incidentId}`;
    if (this.confirmed.has(key)) return false;
    this.confirmed.add(key);
    return true;
  }

  async hasConfirmed(reporterId: string, incidentId: string): Promise<boolean> {
    return this.confirmed.has(`${reporterId}|${incidentId}`);
  }

  async confirmers(incidentId: string): Promise<string[]> {
    return [...this.confirmed].filter((k) => k.endsWith(`|${incidentId}`)).map((k) => k.split('|')[0]);
  }

  async subgraph(incidentId: string): Promise<Subgraph> {
    const ids = new Set(this.incidents.get(incidentId)?.incident.complaintIds);
    const all = [...this.complaints.values()];
    return buildSubgraph(incidentId, all.filter((c) => ids.has(c.id)), all);
  }

  async downstream(zone: string, hops: number): Promise<Downstream[]> {
    return downstream(this.city, zone, hops);
  }
}
