import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Complaint, IssueType } from '@bharatpulse/engine';
import type { Auth } from './auth.js';
import { CITY, CITY_CENTER, SERVICE_RADIUS_KM, directoryFor } from './data.js';
import type { PlaceFinder } from './places.js';
import { haversineMeters } from '@bharatpulse/engine';
import type { Officers } from './officers.js';
import { AppError } from './errors.js';
import { classify, nearFacility, nearestLocality, normalizeProof, readPhoto, transcribe } from './intake.js';
import { replayOutage, SCENARIOS, rng } from './scenarios.js';
import type { Role } from './types.js';
import { RULES } from './workflow.js';
import type { IncidentService } from './service.js';
import type { StoredIncident } from './types.js';

/** The JSON an officer's dashboard sees: the engine's incident plus lifecycle fields. */
function present(s: StoredIncident, repeat?: { count: number; lastFixedAt: number }) {
  return {
    repeat,
    ...s.incident,
    status: s.status,
    detectedAt: s.detectedAt,
    updatedAt: s.updatedAt,
    resolvedAt: s.resolvedAt,
    resolution: s.resolution,
    mergedInto: s.mergedInto,
    hasProof: !!s.proof,
    workflow: s.workflow,
    possibleCause: s.possibleCause,
  };
}

export interface AppDeps {
  auth?: Auth;
  /** Without a verified session, only the old reporterId body field is accepted when this is false (tests, simulator). */
  requireOtp?: boolean;
  sarvamKey?: string;
  /** If set, /admin routes need this in the x-admin-key header. */
  adminKey?: string;
  fetchFn?: typeof fetch;
  /** When set, officer actions need a signed-in officer (x-officer token) and the x-role header is ignored. */
  officers?: Officers;
  /** The phone must report its own location, and the pin must be within 3 km of it. */
  geofence?: boolean;
  /** Finds real offices, addresses and phone numbers near a point (Google or OpenStreetMap). */
  places?: PlaceFinder;
  /** Turns a place name into coordinates, for "change area" on the public page. */
  search?: (q: string) => Promise<{ name: string; lat: number; lng: number }[]>;
}

const ROLES = ['L1', 'L2', 'L3', 'L4', 'CITIZEN'];
/** How far the pin may be from the phone's own location. A neighbourhood, not a city. */
export const PIN_LIMIT_M = 3000;

/**
 * Builds the HTTP app around a service. Nothing is listening yet, so tests can
 * call `app.inject(...)` against the real routes without opening a port.
 */
export function buildApp(service: IncidentService, options: FastifyServerOptions = {}, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ bodyLimit: 8 * 1024 * 1024, ...options });
  // The web app is hosted on another origin, so allow it (and its custom headers). Set CORS_ORIGIN to the web URL in production.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', process.env.CORS_ORIGIN ?? '*');
    reply.header('access-control-allow-headers', 'content-type,x-session,x-role,x-admin-key,x-officer');
    reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const header = (r: { headers: Record<string, unknown> }, name: string): string | undefined => str(r.headers[name]);
  const needAuth = (): Auth => {
    if (!deps.auth) throw new AppError(501, 'otp_disabled', 'Phone verification is not configured');
    return deps.auth;
  };
  const reporter = (r: { headers: Record<string, unknown> }): string => needAuth().session(header(r, 'x-session'));
  /** The officer role of this request. With officer login on, only a signed-in officer counts; otherwise the legacy x-role header (tests, simulators). */
  const officerRole = (r: { headers: Record<string, unknown> }): Role | undefined => {
    if (deps.officers) return header(r, 'x-officer') ? deps.officers.who(header(r, 'x-officer')).role : undefined;
    const h = header(r, 'x-role') as Role | undefined;
    return h && h !== 'CITIZEN' ? h : undefined;
  };
  const needOfficer = (r: { headers: Record<string, unknown> }): Role => {
    const role = officerRole(r);
    if (!role) throw new AppError(401, 'not_signed_in', 'Sign in as an officer first');
    return role;
  };
  const admin = (r: { headers: Record<string, unknown> }): void => {
    if (!deps.adminKey && process.env.NODE_ENV === 'production') throw new AppError(403, 'admin_disabled', 'Set ADMIN_KEY to use admin routes');
    if (deps.adminKey && header(r, 'x-admin-key') !== deps.adminKey) throw new AppError(401, 'admin_only', 'Admin key required');
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.headers) reply.headers(error.headers);
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    // Fastify's own client errors (bad JSON, body too large) carry a 4xx statusCode and a safe message.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = status === 413 ? 'payload_too_large' : 'bad_request';
      return reply.code(status).send({ error: { code, message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found` } });
  });

  app.get('/health', async () => ({ status: 'ok', voice: !!deps.sarvamKey, officerLogin: !!deps.officers, geofence: !!deps.geofence, admin: deps.adminKey ? 'key' : process.env.NODE_ENV === 'production' ? 'off' : 'open' }));

  app.post('/otp/request', async (request) => needAuth().request(((request.body ?? {}) as Record<string, unknown>).phone));

  app.post('/officer/login', async (request) => {
    if (!deps.officers) throw new AppError(501, 'officer_login_disabled', 'Officer login is not configured');
    const b = (request.body ?? {}) as Record<string, unknown>;
    return deps.officers.login(b.id, b.role, b.password);
  });

  app.post('/voice/transcribe', async (request) => {
    reporter(request);
    if (!deps.sarvamKey) throw new AppError(503, 'voice_unavailable', 'Voice is not configured; please type your complaint');
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (typeof b.audio !== 'string') throw new AppError(400, 'validation_error', 'audio (base64) is required');
    return transcribe(Buffer.from(b.audio, 'base64'), str(b.audioMime) ?? 'audio/wav', deps.sarvamKey, deps.fetchFn);
  });

  app.post('/otp/verify', async (request) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    return needAuth().verify(b.phone, b.code);
  });

  app.post('/complaints', async (request, reply) => {
    const body = { ...((request.body ?? {}) as Record<string, unknown>) };
    const token = header(request, 'x-session');
    const extra: Partial<Complaint> = {};
    if (token || deps.requireOtp) {
      const id = reporter(request);
      const profile = needAuth().profile(id);
      body.reporterId = id;
      extra.reporterAgeMs = Date.now() - profile.firstSeen;
      extra.reporterHistory = { confirmedResolved: profile.confirmedResolved, lostDisputes: profile.lostDisputes };
      extra.ipHash = needAuth().ipHash(request.ip);
    }

    let text = str(body.text);
    if (typeof body.audio === 'string') {
      if (!deps.sarvamKey) throw new AppError(503, 'voice_unavailable', 'Voice is not configured; please type your complaint');
      text = (await transcribe(Buffer.from(body.audio, 'base64'), str(body.audioMime) ?? 'audio/wav', deps.sarvamKey, deps.fetchFn)).text;
      body.text = text;
    }
    if (body.issueType === undefined) body.issueType = (text ? classify(text) : undefined) ?? (body.category === 'ROAD' ? 'OTHER_ROAD' : body.category === 'WATER' ? 'OTHER_WATER' : undefined);
    if (typeof body.address === 'string') {
      if (body.address.length > 120) throw new AppError(400, 'validation_error', 'address must be at most 120 characters');
      extra.address = body.address.trim() || undefined;
    }
    if (deps.geofence && typeof body.lat === 'number' && typeof body.lng === 'number') {
      if (typeof body.deviceLat !== 'number' || typeof body.deviceLng !== 'number') throw new AppError(403, 'location_required', 'Allow location access so we can confirm you are at the place');
      if (haversineMeters({ lat: body.lat, lng: body.lng }, { lat: body.deviceLat, lng: body.deviceLng }) > PIN_LIMIT_M) throw new AppError(403, 'too_far_from_you', 'The pin must be within 3 km of where you are');
    }

    if (Array.isArray(body.photos)) {
      if (body.photos.length > 2 || body.photos.some((x) => typeof x !== 'string')) throw new AppError(400, 'validation_error', 'photos must be at most 2 base64 strings');
      const facts = await Promise.all((body.photos as string[]).map(readPhoto));
      extra.photoHashes = facts.map((f) => f.hash);
      extra.exifTime = facts.find((f) => f.exifTime !== undefined)?.exifTime;
    }
    if (typeof body.lat === 'number' && typeof body.lng === 'number') {
      extra.localityId = nearestLocality(body.lat, body.lng);
      if (['POTHOLE', 'CAVE_IN', 'WATERLOGGING'].includes(str(body.issueType) ?? '')) extra.nearFacility = nearFacility(body.lat, body.lng);
    }
    const { complaint, incidentId } = await service.submitComplaint(body, extra);
    return reply.code(201).send({ complaint: { ...complaint, deviceId: undefined, ipHash: undefined }, incidentId, transcript: text });
  });

  app.get<{ Querystring: { status?: string } }>('/incidents', async (request) => {
    const active = request.query.status === 'all' ? await service.listAll() : await service.listActive();
    const rep = await service.repeatMap();
    return { count: active.length, incidents: active.map((s) => present(s, rep.get(s.incident.id))) };
  });

  app.get<{ Params: { id: string } }>('/incidents/:id', async (request) => present(await service.getIncident(request.params.id)));

  app.post<{ Params: { id: string } }>('/incidents/:id/resolve', async (request) => present(await service.resolve(request.params.id)));

  app.post<{ Params: { id: string } }>('/incidents/:id/escalate', async (request) => present(await service.escalate(request.params.id)));

  app.post<{ Params: { id: string; action: string } }>('/incidents/:id/actions/:action', async (request) => {
    // With officer login on, the role comes from the signed-in officer. The x-role header is only honoured when it is off (tests, simulators).
    const role = officerRole(request) ?? 'CITIZEN';
    if (!ROLES.includes(role)) throw new AppError(400, 'validation_error', `role must be one of ${ROLES.join(', ')}`);
    const b = (request.body ?? {}) as Record<string, unknown>;
    let proofHash = str(b.proofHash);
    let photo: string | undefined;
    if (request.params.action === 'resolve' && typeof b.proofPhoto === 'string') ({ photo, hash: proofHash } = await normalizeProof(b.proofPhoto));
    const result = await service.act(request.params.id, { action: request.params.action, role, note: str(b.note), reason: str(b.reason), proofHash, decision: str(b.decision) }, role === 'CITIZEN' ? reporter(request) : undefined, photo);
    return present(result);
  });

  const trustExtra = (r: { headers: Record<string, unknown>; ip: string }, b: Record<string, unknown>): Partial<Complaint> => ({ deviceId: str(b.deviceId)?.slice(0, 64), ipHash: needAuth().ipHash(r.ip) });

  app.get<{ Querystring: { lat?: string; lng?: string } }>('/nearby', async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    if (request.query.lat === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new AppError(400, 'validation_error', 'lat and lng are required');
    let me: string | undefined;
    try { me = deps.auth?.session(header(request, 'x-session')); } catch { /* not signed in: the list is the same, just without "already reported" marks */ }
    return { items: await service.nearby(lat, lng, undefined, me) };
  });

  app.post<{ Params: { id: string } }>('/nearby/:id/metoo', async (request) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') throw new AppError(400, 'validation_error', 'lat and lng are required');
    return service.metooAny(reporter(request), request.params.id, b.lat, b.lng, trustExtra(request, b));
  });

  app.get<{ Params: { id: string } }>('/public/item/:id', async (request) => {
    const item = await service.publicItem(request.params.id);
    if (!item) throw new AppError(404, 'not_found', 'This report is no longer open');
    return item;
  });
  app.post('/checkins', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (b.status !== 'CAME' && b.status !== 'LATE' && b.status !== 'NONE') throw new AppError(400, 'validation_error', 'status must be CAME, LATE or NONE');
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') throw new AppError(400, 'validation_error', 'lat and lng are required');
    return reply.code(201).send(await service.checkin(reporter(request), b.status, b.lat, b.lng));
  });
  app.get('/checkins/mine', async (request) => ({ checkins: await service.myCheckins(reporter(request), 7) }));
  app.get<{ Querystring: { lat?: string; lng?: string; km?: string } }>('/public/supply', async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    return service.supply(request.query.lat !== undefined && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, km: Math.min(50, Math.max(1, Number(request.query.km) || 10)) } : undefined);
  });

  const noticeRole = (r: { headers: Record<string, unknown> }): Role => {
    const role = needOfficer(r);
    if (role !== 'L2' && role !== 'L3') throw new AppError(403, 'forbidden', 'Only zonal officers and department heads can announce planned work');
    return role;
  };
  app.get<{ Querystring: { lat?: string; lng?: string } }>('/notices/near', async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    if (request.query.lat === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new AppError(400, 'validation_error', 'lat and lng are required');
    return { notices: await service.noticesNear(lat, lng) };
  });
  app.get('/notices', async (request) => { needOfficer(request); return { notices: await service.allNotices() }; });
  app.post('/notices', async (request, reply) => reply.code(201).send(await service.addNotice((request.body ?? {}) as Record<string, unknown>, noticeRole(request))));
  app.delete<{ Params: { id: string } }>('/notices/:id', async (request) => { noticeRole(request); await service.removeNotice(request.params.id); return { removed: true }; });

  app.get<{ Querystring: { lat?: string; lng?: string; km?: string } }>('/public/summary', async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    const km = Math.min(50, Math.max(1, Number(request.query.km) || 10));
    return service.publicSummary(request.query.lat !== undefined && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, km } : undefined);
  });
  app.get<{ Querystring: { q?: string } }>('/public/search', async (request) => ({ places: deps.search ? await deps.search(String(request.query.q ?? '')).catch(() => []) : [] }));
  app.get<{ Params: { id: string } }>('/public/proof/:id', async (request) => {
    const s = await service.proofOf(request.params.id);
    if (!s || !['CONFIRMED', 'CLOSED'].includes(s.workflow?.stage ?? '') || s.workflow?.rejection) throw new AppError(404, 'not_found', 'No public photo for this');
    return { photo: s.proof!.photo, at: s.proof!.at };
  });
  app.get<{ Params: { id: string } }>('/incidents/:id/proof', async (request) => {
    if (!officerRole(request)) reporter(request); // an officer, or a verified citizen
    const s = await service.proofOf(request.params.id);
    if (!s) throw new AppError(404, 'not_found', 'No fix photo uploaded yet');
    return { photo: s.proof!.photo, hash: s.proof!.hash, by: s.proof!.by, at: s.proof!.at };
  });
  app.get('/risk/zones', async (request) => { needOfficer(request); return { zones: await service.riskZones() }; });

  app.post<{ Params: { id: string } }>('/incidents/:id/metoo', async (request) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') throw new AppError(400, 'validation_error', 'lat and lng are required');
    return present(await service.metoo(reporter(request), request.params.id, b.lat, b.lng, trustExtra(request, b)));
  });

  app.get<{ Params: { id: string } }>('/incidents/:id/graph', async (request) => service.subgraph(request.params.id));
  app.get<{ Params: { id: string }; Querystring: { hops?: string } }>('/zones/:id/downstream', async (request) => ({ zone: request.params.id, downstream: await service.downstream(request.params.id, Math.min(3, Number(request.query.hops) || 3)) }));
  app.get<{ Params: { id: string; reporterId: string } }>('/certificates/:id/:reporterId', async (request) => service.certificate(request.params.id, request.params.reporterId));
  app.get('/workflow', async () => RULES);
  app.get<{ Querystring: { lat?: string; lng?: string; category?: string } }>('/directory', async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    if (request.query.lat === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return service.directory();
    const category = request.query.category === 'ROADS' ? 'ROADS' : 'WATER';
    const nearby = deps.places ? await deps.places(lat, lng, category).catch(() => ({ offices: [] })) : { offices: [] };
    return { ...directoryFor(CITY, lat, lng, category), nearby };
  });
  app.get('/complaints/pending', async (request) => { needOfficer(request); return { reports: await service.pending() }; });
  app.get('/complaints/mine', async (request) => {
    const mine = await service.mine(reporter(request));
    return { complaints: mine.map((c) => ({ ...c, office: directoryFor(CITY, c.lat, c.lng, ['POTHOLE', 'CAVE_IN', 'WATERLOGGING', 'OTHER_ROAD'].includes(c.issueType) ? 'ROADS' : 'WATER').office })) };
  });
  app.get('/city', async () => ({ ...CITY, service: { center: CITY_CENTER, radiusKm: SERVICE_RADIUS_KM } }));
  app.get('/stats', async () => service.stats());

  app.post('/admin/scenario', async (request, reply) => {
    admin(request);
    const b = (request.body ?? {}) as Record<string, unknown>;
    const make = SCENARIOS[String(b.kind)];
    if (!make) throw new AppError(400, 'validation_error', `kind must be one of ${Object.keys(SCENARIOS).join(', ')}`);
    const where = CITY.localities.find((l) => l.id === b.locality) ?? CITY.localities[0];
    const tag = `${String(b.kind)}-${Date.now().toString(36)}-`;
    const n = Math.min(200, Math.max(1, Number(b.n) || 30));
    const created = await service.ingestDemo(make({ n, at: where, now: Date.now(), r: rng(Date.now() % 100000), prefix: tag }));
    return reply.code(201).send({ added: n, incidents: created.map((x) => present(x)) });
  });

  app.post('/admin/seed', async (request, reply) => { admin(request); return reply.code(201).send({ complaints: await service.loadSample() }); });
  app.post('/admin/reset', async (request) => { admin(request); await service.clear(); return { cleared: true }; });

  app.get<{ Querystring: { minute?: string } }>('/admin/replay', async (request) => replayOutage(Math.min(120, Math.max(0, Number(request.query.minute) || 0))));

  return app;
}
