# BharatPulse: decisions (stable; change only when a decision changes)

**Product.** Turns many noisy civic complaints into a few trusted, ranked incidents for an officer, and resists fake reports.
Categories: WATER (main), ROADS. Competes under hackFront T5 Open Source and Innovation, plus the Neo4j and Sarvam tracks.
Stack: TypeScript, Fastify, Neo4j Aura (replaces Postgres), Sarvam (voice/translate), React + Vite + Leaflet.
Honesty: OTP is simulated, the risk index is a heuristic, photo hashes catch reuse not fakes, all demo data is labelled.

## Authenticity per report (built in 3A, `trust.ts`)
Start 60, clamp 0-100. Missing data changes nothing.
GPS within eps of centre +15 | beyond 2 x eps -30 | past confirmed report +10 | past lost dispute -15 |
device used by >2 accounts -25 | IP hash used by >3 accounts in 1 h -10 (weak, never blocks) |
photo reused by another reporter -25, at another place (>1 km) -40 | EXIF time within 6 h +5, else -10 |
near-identical text (Jaccard > 0.9) from another reporter -15 | new account (<24 h) in a burst of 5 in 10 min -15 |
submitted in <3 s -10 | 3+ independent groups in the incident +10.
Bands: 70+ TRUSTED, 40-69 REVIEW, <40 LIKELY_FAKE (kept in the audit trail, left out of the count).
Photo match: identical hash, or 16-hex perceptual hashes at most 5 bits apart.

## Independent sources
Reports linked by the same reporter, device or photo form one group. `nEff` = sum over groups of (mean authenticity / 100).
A source is TRUSTED when its mean authenticity is 70+. Fewer than 3 trusted sources = `needsVerification`, never CRITICAL.

## Priority score = base x credibility (credibility = mean authenticity of kept reports / 100)
Water: sources 30 (30 x min(1, ln(1+nEff) / ln(1+25))), velocity 25, spread 15, duration 15, issue type 15.
Roads: sources 25, size 20, road class 20, duration 15, facilities 10, photo 10.
Levels: CRITICAL 75+, HIGH 50+, MEDIUM 25+, LOW below. Per-family settings: WATER 500 m / 3 h / min 3; ROAD 40 m / 14 days / min 2.

## Me-too (server, stage 3B/3C)
OTP-verified phone only, one per phone per incident, must be near, not your own complaint, per-phone rate limit, no undo.
The lock is server-side (Cypher MERGE on CONFIRMED); the button shows Confirmed after the tap and after a reload.

## Graph (Neo4j, stage 3B)
Nodes: Complaint, Reporter, Device, Photo, Locality, Zone, Incident, Facility.
Edges: FILED, FROM_DEVICE, HAS_PHOTO, IN, PART_OF (locality-zone and complaint-incident), FEEDS (zone-zone), CONFIRMED, LOCATED_IN, POSSIBLE_CAUSE.
Queries the UI must show: fake clusters (shared device/photo), downstream impact (FEEDS, 1-3 hops), leak-to-pothole POSSIBLE_CAUSE (within ~100 m, last 7 days).

## Officer workflow (stage 3D/3E)
Roles L1 field officer, L2 zonal officer, L3 department head, L4 commissioner (dropdown, no real login).
Reported -> scored -> L1 verifies -> L2 approves -> assigned -> in progress -> resolved (proof photo required) -> citizen confirms -> closed or reopened.
Reject-as-fake needs a reason code and L2 approval; the citizen may dispute once (goes up one level); SLA breach escalates one level.
Certificate only for a verified, resolved, citizen-confirmed incident (first independent reporter and confirmers). No money.
Agency numbers come only from official sources; only 112 is prefilled.

## Evidence and evaluation (T5 rules)
8-12 real conversations; name the user after 5. Planted-attack and genuine-mass-outage tests with reported detection and false-positive rates.
Second category chosen after the conversations.

## Decisions made while building Drop A (backend)
- OTP is simulated: one fixed code from `OTP_CODE`. Phones and IPs are stored only as salted HMAC hashes. Sessions and reporter history live in memory and reset on restart (shortcut).
- The officer role comes from the `x-role` header (L1-L4). That is a demo shortcut, not security; real login replaces it before real use.
- Workflow stages: REPORTED, VERIFIED, APPROVED, ASSIGNED, IN_PROGRESS, RESOLVED, CONFIRMED, CLOSED, plus REJECTED and DISPUTED. Resolve needs a proof photo hash, reject needs a reason.
- A rejection becomes final when L2 approves it. The citizen who reported may dispute once; that reactivates the incident at level 3. L3 upholds (closed, and the citizen's `lostDisputes` goes up) or overturns (back to VERIFIED).
- SLA: CRITICAL 4 h, HIGH 12 h, MEDIUM 24 h, LOW 72 h; roads get 3x. A missed deadline moves the incident up one level (max 3) the next time anyone looks.
- Me-too adds the confirmer's complaint to the incident (same issue type as the incident's main one) and records a CONFIRMED link. The lock is `IncidentStore.confirm`, atomic in the store. Location is the client's GPS, which a determined user can fake.
- Certificate: valid when the incident is CONFIRMED or CLOSED without a rejection. Roles: First Reporter (earliest TRUSTED report) and Verified Contributor (me-too confirmers). The id is `<incidentId>/<reporterId>`; verifying it just re-checks eligibility.
- Leak-to-pothole: a ROAD incident within 100 m of an INFRASTRUCTURE incident first reported up to 7 days earlier gets `possibleCause` (officer confirm/reject field exists, no route yet).
- Server complaint window is now 15 days so roads (14-day cluster window) are not dropped.
- Photos arrive as base64 (at most 2, 4 MB each); we keep only a 16-hex perceptual hash and the EXIF capture time, never the image.
- Voice: Sarvam `saaras:v4`, mode transcribe, then keyword classification (English, Hinglish, Devanagari). No LLM.
- The graph answers: `/incidents/:id/graph` (nodes, edges, devices shared by 3+ reporters across all history) and `/zones/:id/downstream`. Neo4j and memory implement the same interface.
- Evaluation (`npm run eval`) uses fixed seeds. "Sophisticated" fake campaigns (every signal looks human) get through by design of the test; we report that.

## Decisions made while building Drop B (web)
- React + Vite + Leaflet, no UI framework, hash routing (`/#/officer`, `/#/verify/...`). One stylesheet. No state library.
- Workflow rules are served by the API (`GET /workflow`), so the buttons an officer sees always match what the server allows.
- Citizen state (session, device id, my complaints, confirmed incidents) lives in the browser's localStorage. The server still enforces the me-too lock.
- A complaint that has not yet become an incident (fewer than 3 reports) shows an honest "needs 3 neighbours" message.
- Original photos are sent as taken (so the capture time survives); photos over 3.5 MB are shrunk to a JPEG first.
- Voice is recorded with the browser's MediaRecorder and sent as it comes (usually webm/opus). Whether Sarvam accepts that format is unverified: use `npm run sarvam:smoke` and, if needed, convert in the browser.
- Officer "Performance" is the stats strip plus the audit log per incident; no separate dashboard.
- CORS allows `CORS_ORIGIN` (default `*`) and the custom headers x-session, x-role, x-admin-key.

## Decisions made in Drop C (portal redesign)
- Officers sign in with level, ID and password. Sample accounts share `OFFICER_PASSWORD`. Tokens live in memory. With sign-in on, the `x-role` header is ignored (it still works only when the server runs without officer login, for tests).
- Officers see single reports in "New reports"; an incident still needs 3 reports (roads 2). A single report is never silently invisible.
- Issue type is optional. Unclassified text becomes OTHER_WATER (family SUPPLY) or OTHER_ROAD (family ROAD).
- A citizen may object from the moment a complaint is REJECTED (not only after it is final); the objection goes to level 3.
- Place-aware help: nearest locality, then zone, then the zone committee member, then the office whose zones and categories match. If one office handles both, say so.
- Geofence: pin inside the service area and within 1 km of the phone's reported location. The phone's location is client data, so this stops honest mistakes and casual misuse, not a determined spoofer.
- Voice prefers Sarvam through the server when configured; otherwise the browser's speech recognition. Whichever is used, the words appear in the text box before sending.
- All contact names, phone numbers and office addresses are placeholders marked Sample until real verified data is added.

## Decisions made in Drop D
- Complaints are accepted from any location. The only location rule is: the phone reports its own position and the pin stays within 1 km of it.
- Session and officer tokens are signed and stateless, so they survive restarts if the salt is stable (`ID_SALT`; a fixed development value is used when it is not set outside production).
- Office, address and phone lookups use Google Places when a key is set, else OpenStreetMap. Results are cached a day. Names of zone committee members or officers cannot come from any public API; they come only from our own data file.
- Officer screens show plain language first (what to do, why it matters, who reported it); numbers and the graph are collapsed under Technical details.
- Forward goes one level up (field officer to zonal officer to department head). Overdue items move up one level automatically.
- Single reports are visible to officers but not actionable until they form an incident (3 different people close together, 2 for roads). Open question: let an officer promote one serious report to an incident by hand.

## Decisions made in Drop E
- Single reports are public in "problems near you" without any personal data (type, number of people, age, distance) so neighbours can confirm them. Confirming a report adds one more report from that person; the third makes the incident.
- A fix is not accepted on one officer's word. The proof photo is checked by someone more senior than the uploader; only then does the citizen get the question. A rejected photo sends the work back with a reason.
- Proof photos are shrunk to 1024 px and stored with the incident. They are public only after the citizen confirms the fix.
- Citizen messages are built from the officers' action log in the app, not sent as SMS or WhatsApp (that needs a messaging provider).
- The zone watchlist is a labelled heuristic (open water problems, a run of low-pressure reports, trouble upstream), not a prediction.
- Hindi names: a list of common names, a best-effort spelling for others, and the person confirms or edits it once.

## Decisions made in Drop F
- Ranges: list problems within 2 km; confirm a water problem within 1.5 km and a pothole within 300 m; the pin may be 3 km from the phone. They are starting values chosen for typical phone GPS error; tune them with real users.
- Signing out keeps the phone remembered on this browser (one-tap sign-in without a new code). The saved login still expires with its token (30 days) and can be forgotten.
- The public page is scoped by place (your location or a searched town and a radius) and shows at most the 8 busiest wards.
- Officer portal: a four-column board (New, Working, Fix check, Done), a side panel for details, plain language first, numbers last.

## Decisions made in Drop G
- Water diary: one answer per person per day (India date); a ward needs at least 3 answers to be shown; "chronic" means at least 2 households and at least 3 bad days in the last 7. Reliability counts "late or low" as half.
- Planned-work notices can be created and cancelled only by zonal officers and department heads. They show up for citizens within about 1.5 km of the announced wards, from 7 days ahead until they end. The app does not block complaints during a planned cut; it explains first and asks people to report only if the problem continues.
- A repeat means the same category (road or water) was fixed within 150 m, no more than 180 days before, and before this incident was first reported.
- Read aloud uses the browser's own speech voice; quality and the availability of a Hindi voice depend on the phone.
