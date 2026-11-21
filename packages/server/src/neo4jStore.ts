import { haversineMeters, type Complaint } from '@bharatpulse/engine';
import neo4j, { type Driver } from 'neo4j-driver';
import { CITY, type City } from './data.js';
import { buildSubgraph, type Downstream, type Subgraph } from './graph.js';
import type { IncidentStore } from './store.js';
import type { Checkin, Notice, StoredIncident } from './types.js';

const num = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number));
const TABLES = ['Complaint', 'Reporter', 'Device', 'Photo', 'Incident', 'Zone', 'Locality', 'Facility', 'Checkin', 'Notice'];

/**
 * Neo4j Aura storage. The graph is the product here: devices and photos are shared nodes, so
 * "which accounts are really one source" and "who is downstream of a failed zone" are queries, not code.
 * Complaints and incidents also keep a JSON copy in `data`, so reading them back is one lookup.
 * WRITTEN FROM THE DRIVER DOCS, NOT RUN AGAINST A LIVE DATABASE: run `npm run neo4j:smoke` once with your credentials.
 */
export class Neo4jStore implements IncidentStore {
  private constructor(private readonly driver: Driver, private readonly city: City) {}

  static async connect(uri: string, user: string, password: string, city: City = CITY): Promise<Neo4jStore> {
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    await driver.verifyConnectivity();
    const store = new Neo4jStore(driver, city);
    await store.init();
    return store;
  }

  close(): Promise<void> {
    return this.driver.close();
  }

  private async run(query: string, params: Record<string, unknown> = {}) {
    const session = this.driver.session();
    try {
      return (await session.run(query, params)).records;
    } finally {
      await session.close();
    }
  }

  private async init(): Promise<void> {
    for (const t of TABLES) await this.run(`CREATE CONSTRAINT ${t.toLowerCase()}_id IF NOT EXISTS FOR (n:${t}) REQUIRE n.id IS UNIQUE`);
    await this.run('UNWIND $zones AS z MERGE (n:Zone {id: z.id}) SET n.name = z.name', { zones: this.city.zones });
    await this.run('UNWIND $zones AS z UNWIND z.feeds AS to MATCH (a:Zone {id: z.id}), (b:Zone {id: to}) MERGE (a)-[:FEEDS]->(b)', { zones: this.city.zones });
    await this.run('UNWIND $ls AS l MERGE (n:Locality {id: l.id}) SET n.name = l.name WITH n, l MATCH (z:Zone {id: l.zoneId}) MERGE (n)-[:PART_OF]->(z)', { ls: this.city.localities });
    const near = (f: { lat: number; lng: number }) => [...this.city.localities].sort((a, b) => haversineMeters(f, a) - haversineMeters(f, b))[0].id;
    await this.run('UNWIND $fs AS f MERGE (n:Facility {id: f.id}) SET n.name = f.name, n.type = f.type WITH n, f MATCH (l:Locality {id: f.locality}) MERGE (n)-[:LOCATED_IN]->(l)', {
      fs: this.city.facilities.map((f) => ({ ...f, locality: near(f) })),
    });
  }

  async addComplaint(c: Complaint): Promise<void> {
    try {
      await this.run(
        `MERGE (r:Reporter {id: $reporterId})
         CREATE (c:Complaint {id: $id, createdAt: $createdAt, issueType: $issueType, data: $data})
         MERGE (r)-[:FILED]->(c)
         FOREACH (_ IN CASE WHEN $deviceId IS NULL THEN [] ELSE [1] END | MERGE (d:Device {id: $deviceId}) MERGE (c)-[:FROM_DEVICE]->(d))
         FOREACH (_ IN CASE WHEN $localityId IS NULL THEN [] ELSE [1] END | MERGE (l:Locality {id: $localityId}) MERGE (c)-[:IN]->(l))
         WITH c UNWIND $photos AS h MERGE (p:Photo {id: h}) MERGE (c)-[:HAS_PHOTO]->(p)`,
        { ...c, deviceId: c.deviceId ?? null, localityId: c.localityId ?? null, photos: c.photoHashes ?? [], data: JSON.stringify(c) },
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') throw new Error(`complaint ${c.id} already exists`);
      throw e;
    }
  }

  async complaintsSince(since: number): Promise<Complaint[]> {
    const rows = await this.run('MATCH (c:Complaint) WHERE c.createdAt >= $since RETURN c.data AS data ORDER BY c.createdAt, c.id', { since });
    return rows.map((r) => JSON.parse(r.get('data')) as Complaint);
  }

  async listIncidents(): Promise<StoredIncident[]> {
    return (await this.run('MATCH (i:Incident) RETURN i.data AS data')).map((r) => JSON.parse(r.get('data')) as StoredIncident);
  }

  async getIncident(id: string): Promise<StoredIncident | undefined> {
    const rows = await this.run('MATCH (i:Incident {id: $id}) RETURN i.data AS data', { id });
    return rows[0] ? (JSON.parse(rows[0].get('data')) as StoredIncident) : undefined;
  }

  async saveIncidents(records: readonly StoredIncident[]): Promise<void> {
    const session = this.driver.session();
    try {
      for (const r of records) {
        await session.executeWrite(async (tx) => {
          const id = r.incident.id;
          await tx.run('MERGE (i:Incident {id: $id}) SET i.data = $data, i.status = $status, i.family = $family', { id, data: JSON.stringify(r), status: r.status, family: r.incident.family });
          await tx.run('MATCH (i:Incident {id: $id}) OPTIONAL MATCH (:Complaint)-[old:PART_OF]->(i) DELETE old', { id });
          await tx.run('MATCH (i:Incident {id: $id}) UNWIND $cids AS cid MATCH (c:Complaint {id: cid}) MERGE (c)-[:PART_OF]->(i)', { id, cids: r.incident.complaintIds });
          await tx.run('MATCH (i:Incident {id: $id}) OPTIONAL MATCH (i)-[old:POSSIBLE_CAUSE]->() DELETE old', { id });
          if (r.possibleCause) await tx.run('MATCH (a:Incident {id: $id}), (b:Incident {id: $to}) MERGE (a)-[:POSSIBLE_CAUSE]->(b)', { id, to: r.possibleCause.incidentId });
        });
      }
    } finally {
      await session.close();
    }
  }

  async clear(): Promise<void> {
    await this.run('MATCH (n) WHERE n:Complaint OR n:Reporter OR n:Device OR n:Photo OR n:Incident OR n:Checkin OR n:Notice DETACH DELETE n');
  }

  async addCheckin(c: Checkin): Promise<void> {
    await this.run('MERGE (k:Checkin {id: $id}) SET k.at = $at, k.data = $data', { id: c.id, at: c.at, data: JSON.stringify(c) });
  }

  async checkinsSince(since: number): Promise<Checkin[]> {
    return (await this.run('MATCH (k:Checkin) WHERE k.at >= $since RETURN k.data AS data ORDER BY k.at', { since })).map((r) => JSON.parse(r.get('data')) as Checkin);
  }

  async saveNotice(n: Notice): Promise<void> {
    await this.run('MERGE (k:Notice {id: $id}) SET k.startsAt = $startsAt, k.data = $data', { id: n.id, startsAt: n.startsAt, data: JSON.stringify(n) });
  }

  async listNotices(): Promise<Notice[]> {
    return (await this.run('MATCH (k:Notice) RETURN k.data AS data ORDER BY k.startsAt')).map((r) => JSON.parse(r.get('data')) as Notice);
  }

  async deleteNotice(id: string): Promise<boolean> {
    return (await this.run('MATCH (k:Notice {id: $id}) DETACH DELETE k RETURN 1 AS x', { id })).length > 0;
  }

  async confirm(reporterId: string, incidentId: string): Promise<boolean> {
    const rows = await this.run(
      `MERGE (r:Reporter {id: $reporterId}) WITH r MATCH (i:Incident {id: $incidentId})
       MERGE (r)-[x:CONFIRMED]->(i) ON CREATE SET x.fresh = true ON MATCH SET x.fresh = false RETURN x.fresh AS fresh`,
      { reporterId, incidentId },
    );
    return rows[0]?.get('fresh') === true;
  }

  async hasConfirmed(reporterId: string, incidentId: string): Promise<boolean> {
    return (await this.run('MATCH (:Reporter {id: $reporterId})-[:CONFIRMED]->(:Incident {id: $incidentId}) RETURN 1 AS x', { reporterId, incidentId })).length > 0;
  }

  async confirmers(incidentId: string): Promise<string[]> {
    return (await this.run('MATCH (r:Reporter)-[:CONFIRMED]->(:Incident {id: $incidentId}) RETURN r.id AS id', { incidentId })).map((r) => r.get('id'));
  }

  async subgraph(incidentId: string): Promise<Subgraph> {
    const members = (await this.run('MATCH (:Incident {id: $incidentId})<-[:PART_OF]-(c:Complaint) RETURN c.data AS data', { incidentId })).map((r) => JSON.parse(r.get('data')) as Complaint);
    // The graph does the counting: every account on that device, in every incident, not just this one.
    const shared = await this.run(
      `MATCH (:Incident {id: $incidentId})<-[:PART_OF]-(:Complaint)-[:FROM_DEVICE]->(d:Device)<-[:FROM_DEVICE]-(:Complaint)<-[:FILED]-(r:Reporter)
       WITH d, count(DISTINCT r) AS reporters WHERE reporters > 2 RETURN d.id AS deviceId, reporters`,
      { incidentId },
    );
    return { ...buildSubgraph(incidentId, members, members), sharedDevices: shared.map((r) => ({ deviceId: r.get('deviceId'), reporters: num(r.get('reporters')) })) };
  }

  async downstream(zone: string, hops: number): Promise<Downstream[]> {
    const h = Math.min(3, Math.max(1, Math.floor(hops))); // inlined: Cypher cannot parameterise path length
    const rows = await this.run(
      `MATCH p = (:Zone {id: $zone})-[:FEEDS*1..${h}]->(d:Zone) WITH d, min(length(p)) AS hops
       OPTIONAL MATCH (l:Locality)-[:PART_OF]->(d) RETURN d.id AS zone, hops, collect(l.id) AS localities ORDER BY hops, zone`,
      { zone },
    );
    return rows.map((r) => ({ zone: r.get('zone'), hops: num(r.get('hops')), localities: [...r.get('localities')].sort() }));
  }
}
