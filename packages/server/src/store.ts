import type { Complaint } from '@bharatpulse/engine';
import type { Downstream, Subgraph } from './graph.js';
import type { Checkin, Notice, StoredIncident } from './types.js';

/**
 * Everything the service needs from storage. Async on purpose: the in-memory
 * version could be sync, but the Neo4j version cannot, and the service
 * should not care which one it gets.
 */
export interface IncidentStore {
  /** Throws if a complaint with the same id already exists. */
  addComplaint(complaint: Complaint): Promise<void>;
  /** Complaints with createdAt >= since, oldest first. */
  complaintsSince(since: number): Promise<Complaint[]>;
  /** Every incident, any status. */
  listIncidents(): Promise<StoredIncident[]>;
  getIncident(id: string): Promise<StoredIncident | undefined>;
  /** Insert or replace by `incident.id`. */
  saveIncidents(records: readonly StoredIncident[]): Promise<void>;
  /** Saves a diary answer (one per person per day: a second answer replaces the first). */
  addCheckin(c: Checkin): Promise<void>;
  checkinsSince(since: number): Promise<Checkin[]>;
  saveNotice(n: Notice): Promise<void>;
  listNotices(): Promise<Notice[]>;
  deleteNotice(id: string): Promise<boolean>;
  /** Removes complaints, incidents and confirmations (not the city). Used to reset sample data. */
  clear(): Promise<void>;
  /** Records "this reporter also has the problem". Returns false if it was already recorded (the lock is here, not in the UI). */
  confirm(reporterId: string, incidentId: string): Promise<boolean>;
  hasConfirmed(reporterId: string, incidentId: string): Promise<boolean>;
  /** Reporters who confirmed an incident. */
  confirmers(incidentId: string): Promise<string[]>;
  /** The incident as a graph (reporters, devices, photos). */
  subgraph(incidentId: string): Promise<Subgraph>;
  /** Localities hit next if a zone fails. */
  downstream(zone: string, hops: number): Promise<Downstream[]>;
}
