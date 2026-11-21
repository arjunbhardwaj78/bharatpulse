# HANDOFF (snapshot, overwritten each stage): BharatPulse, after Drop G + deploy-fix pass (Drop H)
Read DECISIONS.md first; it holds every rule we agreed.

## Who I am and how to work with me
- Arjun, 2nd-year B.Tech CSE (AI/DS), GLA University, India. Goal: 12+ LPA campus placement.
- Strongest language Java; this project is TypeScript. Beginner-to-intermediate: small stages, EXPLAIN each part so I can defend every line in interviews.
- Style: concise, structured, blunt, informal. No flattery. Flag risks and weak spots.
- Setup: Windows, PowerShell, Node 20+, npm, Git, code on GitHub.
- Honesty rule: all data is simulated, no real users. Never let me claim "production-ready", "deployed" or "AI-powered" for things that aren't. Keep "written" and "verified" separate.

## Standing rules (every stage)
1. (Not done in 3A: I never gave the notes .docx to this chat; upload your copy and I add a Stage 3A section.) Update my ONE cumulative notes document in place ("BharatPulse: Interview Prep and Learning Notes", .docx): never erase or overwrite past content, only add (Q&A rows, key concepts, code map, settings, honest notes, resume bullets for built+tested things only, demo script, checklist, a short "Stage N" section). Present it with the zip every time. If I upload my copy, mine is the source of truth.
2. Present a zip of the WHOLE project named bharatpulse-stageN.zip with source, tests, package.json, package-lock.json, README, .gitignore, HANDOFF.md. Exclude node_modules, dist, build, .env, secrets. Present only after tests pass and state the test count. Give exact Windows PowerShell commands.
3. Give an updated copy of this handoff text. Commit and push at the end of each stage and remind me.
4. If I upload my own zip, treat it as the source of truth; read it first and tell me if it differs.

## State
- Stack: TypeScript, Fastify, Neo4j Aura (replaces Postgres), Sarvam, React + Vite + Leaflet. Track: hackFront T5 + Neo4j + Sarvam. Finale 21-22 Nov 2026.
- Done and tested (engine 57 + server 134 + web 19 = 210): Drops A-F plus Drop G (water diary, planned-work notices, repeat and recently-fixed tracking, nearby map, expected-by time, read aloud). Real-server smoke test passes in jsdom (8 flows).
- NOT verified: the UI in a real browser (look, animation, Hindi fonts, camera, microphone, maps, geolocation on phones, text-to-speech voices); Google Places and OpenStreetMap lookups live; Neo4j on a real Aura database (including the new check-in and notice storage); Sarvam live; an actual deploy.
- NOT done: user interviews, the T5 text, demo video, SMS/WhatsApp messages (in-app updates only), officer confirm/reject of the leak-to-pothole link, manual "promote a report to an incident", notes .docx, real SMS and officer SSO, real zone-committee contacts (placeholders marked Sample), officer portal in Hindi.
- Known shortcuts: sample officer accounts share one password; sign-out keeps the phone remembered on that browser; me-too and the 3 km pin check trust the phone's own location; citizen state in localStorage; the same browser counts as one person (test with private windows).
- Calibration unchanged: naive attacks caught 15/15, careful attacker 0/5, genuine outages falsely flagged 0/10.

## Drop H (deploy-fix pass) - written, NOT test-run
Changed: server refuses to start in production without OFFICER_PASSWORD (warns if no NEO4J_URI); render.yaml sets CORS_ORIGIN=*, GEOFENCE=false, generated OFFICER_PASSWORD; web shows a clear "not connected" error if VITE_API_URL is missing in a production build; README status/roadmap/known limits rewritten; new docs/DEPLOY.md. Run `npm test` before committing (the previous 210 should still pass).

## Drop I (UI redesign, web only) - written, NOT test-run, NOT looked at in a browser
Palette now navy #0f172a + orange #ea580c (CSS vars in ui.css; the old blue/teal is gone). Landing: portals first, new "How It Works" (Snap & Pin / Govt. Dispatches / Fix Verified, SVG icons). Officer bug fixed: the landing "I am an officer" link clears the saved officer login, so the sign-in form always shows (a refresh inside the portal keeps you signed in). Citizen: Home = two big buttons (Water navy, Road orange) + location + Nearby (map first, "I face this too (+1)") + diary; pressing a button starts a 3-step flow (pin, category, snap/describe/submit). Tabs renamed Home / Track / Alerts / Help. Officer: KPI tiles (avg resolution time, SLA compliance, reopened, jobs for you); L1 sees a single-column job queue defaulting to "Needs my action". Smoke test labels updated. Run `npm install && npm test && npm run typecheck && npm run smoke:web` before committing.

## Drop J (visual redesign v2, web only) - written, NOT test-run, NOT looked at in a browser
Palette changed again to match the new landing artwork: royal blue (#12276b / #1f4fc4) + saffron (#f97316) + India green (#138808). Landing rebuilt as a "Welcome to BharatPulse" scene (sky, clouds, SVG Red Fort with lake reflection, India-map emblem, tricolour wave, Citizen/Officer pill buttons), How It Works below it. Citizen app and sign-in use the sky/tricolour background with glass cards; officer sign-in has the fort scene, the sidebar is royal blue with a saffron active item. Hover colours added to every button (Send OTP included). Choosing "Something else" (OTHER_WATER / OTHER_ROAD) now requires a description of at least 5 characters (button disabled + toast); other problem types keep the description optional (front-end check only, the server does not enforce it). Smoke test labels updated (Citizen/Officer words).

## Drop K (fix pass on Drop J, web only) - written, NOT test-run, NOT looked at in a browser
Drop J's CSS rewrite had deleted base rules (How It Works icons, Water/Road big buttons, step header, KPI tiles); restored in ui.css v3. Landing is now ONE screen (height 100svh, no scroll): title, pills, compact How It Works strip, tricolour wave. Stats strip removed from landing; community link moved to the top bar. Red Fort redrawn softer (haze, shading, white marble domes); a real photo at packages/web/public/landing-bg.jpg is used instead when present. Logo mark is now an India map (was a water drop).

## Drop L (citizen portal polish, web only) - checked in a headless-Chromium preview with mocked API and placeholder icons/maps; real `npm test`/typecheck still NOT run, real Leaflet maps and lucide icons NOT seen
Citizen header is now a sky hero (India emblem, tricolour edge), content no longer overlaps it, tab bar redone (saffron active tab, tricolour top line). Fixed real collisions: landing `.pill` class clashed with the small "Sample" badge (landing buttons renamed `.entry`); `.clouds` layer took a grid row and pushed the landing title down; narrow-phone overflow on landing. Logo/emblem use a better India outline. Step-2 card title shortened; "Other problem" description message reworded.

## Drop M (landing v5, web only) - screenshot-checked in a headless-Chromium preview with mocked API; real tests/typecheck NOT run
Landing is now a split layout (modelled on the user's reference): left = glowing India-map emblem + big "Welcome to BharatPulse", headline, Citizen / Officer pills, "See how your area is doing", How It Works (4 cards); right = crew photo (packages/web/public/hero.jpg is a low-res PLACEHOLDER cropped from the user's reference; replace with a clean high-res photo) with a map card, a Before/After ILLUSTRATION card, and a Live status strip using real /stats numbers. Language button is the original "हिंदी में करें / View in English". On phones the photo becomes a top banner. Old landing CSS (.scene/.pill/.entry etc.) is now unused.

## Next
1. Run it and send what looks or behaves wrong. 2. Add keys, run the smoke scripts, deploy and test on a phone over https. 3. Interviews, T5 text, demo video. For further work, start a fresh chat: upload the zip and paste this file.

## PowerShell
```powershell
npm install
npm test               # 57 + 134 + 19
npm run dev:server
npm run dev:web        # http://localhost:5173
```
Apply a new zip: `.\apply.ps1 "$HOME\Downloads\<zip>" "message"`.
