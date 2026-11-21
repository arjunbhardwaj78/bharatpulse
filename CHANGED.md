# Drop G: everyday-citizen features

Each one starts from a real situation and uses data the app already collects.

1. **Water diary** ("I get water for 30 minutes at 6 am and have no proof it fails"): one tap a day, "Did water come today? On time / Late or low / No water". One answer per person per day; the week is shown as coloured dots. Many answers become a reliability figure per ward on the public page ("water came on 40% of the answers", "Needs attention" for chronic wards), and chronic wards feed the officers' "may need attention soon" list. Evidence instead of anecdotes, with no complaint needed.
2. **Planned-work notices** ("I called because there was no water, but it was a scheduled cut"): zonal officers and department heads announce a water cut or road work for chosen wards and times; citizens near them see it at the top of the Report tab, with "if it continues after this time, please report it". Officers manage them under **Notices**.
3. **Repeat problems and recently fixed spots** ("the road is patched and breaks again"): officers see **"Came back"** or **"Fixed 3 times before"** on cards and a note in the detail panel (same kind of problem fixed within 150 m in the last 6 months). Citizens see **"Fixed 4 days ago near here. Is the problem back? Report it below."** in the nearby list.
4. **Clarity and accessibility:** a **Map** of problems near you (open incidents, single reports, recent fixes), **"An officer must act by Thursday 5 pm"** on every complaint, and a **Read aloud** button (Hindi or English, the browser's own voice) on updates and complaints for people who find reading hard.

## Server
`POST /checkins`, `GET /checkins/mine`, `GET /public/supply`, `GET/POST/DELETE /notices`, `GET /notices/near`; incidents carry `repeat`; `/nearby` includes coordinates and recently fixed items. Storage for check-ins and notices in memory and Neo4j (Neo4j part written, not verified live). The sample town now includes a week of diary answers and two notices.

## Counts
Engine 57 + server 134 + web 19 = 210 tests, typecheck clean, production builds verified, real-server smoke test passes (8 flows, including the new features).


# Drop H: deploy fixes (not test-run)
Server fails fast in production without OFFICER_PASSWORD; render.yaml: CORS_ORIGIN, GEOFENCE=false, generated OFFICER_PASSWORD; web VITE_API_URL guard + packages/web/.env.example; README refresh and Known limits; docs/DEPLOY.md.


# Drop I: UI redesign (web only, not test-run)
Navy and orange palette; landing How It Works; officer login always asked from the landing page; citizen Water/Road home plus 3-step report flow; officer KPI tiles and L1 queue; smoke-test labels updated.


# Drop J: visual redesign v2 (web only, not test-run)
Landing scene like the artwork, royal blue + saffron + green palette, glass-card citizen app, styled officer sign-in and sidebar, button hover colours, mandatory description for 'Something else'.


# Drop K: fix pass (web only, not test-run)
Restored dropped CSS, one-screen landing, softer fort, optional landing-bg.jpg, India-map logo, citizen header overlap fix.


# Drop L: citizen portal polish (web only)
Sky hero header, tab bar, class-collision fixes (.pill -> .entry, .clouds), phone landing fit, India outline.


# Drop M: landing v5 (web only)
Split landing, glowing India emblem, big wordmark, live status strip, hero.jpg placeholder.
