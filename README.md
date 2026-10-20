# College Event Manager

A responsive event site with an Express.js API, SQLite persistence, a public event browser, and a password-protected organizer workspace.

## Requirements and setup

- Node.js 20 or newer
- npm

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace `ORGANIZER_PASSWORD` and `SESSION_SECRET` with private values. Use a unique password of at least 12 characters and a random session secret of at least 32 characters.
3. Start the server with `npm start` (or use `npm run dev` during development).
4. Visit `http://localhost:3000` for the public event page and `http://localhost:3000/organizer.html` for organizer sign-in.

The Express server starts the Python recommendation service automatically. Python 3.10+ is required. If Python is not available under `python` (Windows) or `python3` (macOS/Linux), set `PYTHON_COMMAND` in `.env` to the full path of the selected Python executable. The AI service uses Python's standard library, so no Python packages need to be installed. Run the event and registration integration tests with `npm test` (or only those tests with `npm run test:events`); run the AI behavior tests with `npm run test:ai` (or `python -m unittest test_ai_recommender.py`).

If you are opening `index.html` directly with `file://`, Express APIs are not available. For the AI panel only, start the Python service separately with `start-ai.bat` on Windows (leave its terminal window open); browser access is restricted to the local app/file origins. For normal use, prefer `npm start` and `http://localhost:3000`.

The server creates `data/event-manager.sqlite` automatically and loads the sample events on first run. Set `EVENT_DATABASE_FILE` to use a different SQLite database path. If an older `data/events.json` exists, the server imports its events and registrations before seeding samples. The database and environment file are ignored by Git.

The server also adds a one-time batch of 50 clearly labeled sample events dated October 19–30, 2026, to existing databases. This seed is recorded in the database so restarts do not recreate sample events that an organizer later removes.

All 50 additions are available in the regular Future Events list because their dates are October 19–30, 2026.

The server also seeds 20 clearly labeled AI and Robotics sample events into the regular Future Events list. AI recommendations use text similarity, not measured accuracy; the new event details are written to match AI and robotics interests, and users can set the minimum text-match filter to 40%.

## Organizer workspace

The organizer page supports authenticated event creation, editing, and deletion; dashboard totals; a private student-registration list; and registration removal (which returns one seat). Organizer requests use an eight-hour HTTP-only, same-site session, CSRF tokens, login rate limiting, server-side validation, and security headers. Registration details are returned only by the authenticated organizer API.

Organizer event cards use locally stored, representative category photos. They are thematic thumbnails, not organizer-uploaded or event-verified photos. Photo assets are from Unsplash: [technology](https://images.unsplash.com/photo-1518770660439-4636190af475), [performance](https://images.unsplash.com/photo-1492684223066-81342ee5ff30), [sports](https://images.unsplash.com/photo-1521412644187-c49fa049e84d), [creative](https://images.unsplash.com/photo-1513364776144-60967b0f800f), and [nature](https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05).

Public visitors can browse future events. Choosing **Register** opens a separate tab with a registration form for full name, college, and email, plus optional phone, student ID, course/department, and year-of-study details. Registration details are available only to signed-in organizers, are not included in public event listings, and are automatically deleted within 30 days after the event. Students can ask their event organizer through their college about privacy or deletion requests. Seat decrement and registration creation run in a SQLite transaction to avoid overselling. Past and future views are derived from the event date.

## AI feature: explainable event recommendations

The home page accepts interest keywords, an optional date range, and a preferred time of day before asking the private Python service to rank upcoming, available events. Date filters use the event date. Since events do not have dedicated time fields, a time preference only matches a time or time-of-day stated in the event description; events without a stated time are excluded for a specific time preference. The model uses normalized TF-IDF text similarity with a small transparent campus-topic synonym map and explains whether a result contains the entered terms or was related through the synonym map. The adjustable minimum text-match filter is based on cosine similarity; its percentage is not measured prediction accuracy or a guarantee of enjoyment. Interests are used for the request only and are not stored in a profile. This is a lightweight local recommendation model, not a hosted generative-AI service; results use currently published event descriptions.

## AI feature: organizer event-copy assistant

In Organizer Studio, enter an event title, optional category, brief facts, and audience, then choose **Draft with AI**. Python classifies likely event topics, suggests a category, drafts an editable description, and creates a relevant checklist. The endpoint is restricted to an authenticated organizer session with CSRF protection and rate limiting. It uses a small transparent local text-classification/template system rather than a hosted language model; organizers must review and correct every draft before publishing.

## Feedback

Visitors can use the Feedback page to submit an anonymous 1–5 rating and comment about a campus event or events in general. Feedback is stored in the local SQLite database, is limited to ten submissions per 15 minutes per client, and is not exposed through a public listing API.

## API overview

- `GET /api/health` — health status
- `GET /api/events?view=all|past|upcoming` — public event details and aggregate registration counts
- `POST /api/feedback` — submit an anonymous event rating and comment
- `POST /api/recommendations` — interest-based suggestions, proxied to the local Python service
- `POST /api/events/:id/register` — public registration (full name, college, and email required; other student details optional)
- `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout` — organizer session
- `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id` — organizer event management
- `GET /api/organizer/registrations`, `DELETE /api/registrations/:id` — private registration management

This is a secure local-project baseline, not a substitute for a deployment review. Before public production hosting, add individual organizer accounts, HTTPS termination, explicitly configure `TRUST_PROXY=1` only behind a trusted reverse proxy, database backups, monitoring, and an appropriate privacy/retention policy.
