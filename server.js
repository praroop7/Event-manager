require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit").rateLimit;
const helmet = require("helmet");
const Database = require("better-sqlite3");

const ROOT = __dirname;
const DATABASE_FILE = process.env.EVENT_DATABASE_FILE || path.join(ROOT, "data", "event-manager.sqlite");
const DATA_DIR = path.dirname(DATABASE_FILE);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ORGANIZER_PASSWORD = process.env.ORGANIZER_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const AI_HOST = process.env.AI_HOST || "127.0.0.1";
const AI_PORT = Number(process.env.AI_PORT) || 8000;
const PYTHON_COMMAND = process.env.PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3");

if (ORGANIZER_PASSWORD.length < 12 || ORGANIZER_PASSWORD.toLowerCase().includes("change-this")) {
  console.error("Set ORGANIZER_PASSWORD in .env to a unique password of at least 12 characters.");
  process.exit(1);
}
if (SESSION_SECRET.length < 32 || SESSION_SECRET.includes("replace-this")) {
  console.error("Set SESSION_SECRET in .env to a private, random value of at least 32 characters.");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const database = new Database(DATABASE_FILE);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
    date TEXT NOT NULL,
    venue TEXT NOT NULL CHECK(length(venue) BETWEEN 1 AND 200),
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    seats INTEGER NOT NULL DEFAULT 0 CHECK(seats >= 0),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    student TEXT NOT NULL CHECK(length(student) BETWEEN 1 AND 120),
    registered_at TEXT NOT NULL,
    UNIQUE(event_id, student COLLATE NOCASE)
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
  CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

const registrationColumns = new Set(database.pragma("table_info(registrations)").map((column) => column.name));
const additionalRegistrationColumns = [
  ["college_name", "TEXT NOT NULL DEFAULT ''"],
  ["email", "TEXT NOT NULL DEFAULT ''"],
  ["phone", "TEXT NOT NULL DEFAULT ''"],
  ["student_id", "TEXT NOT NULL DEFAULT ''"],
  ["course_department", "TEXT NOT NULL DEFAULT ''"],
  ["year_of_study", "TEXT NOT NULL DEFAULT ''"]
];
for (const [column, definition] of additionalRegistrationColumns) {
  if (!registrationColumns.has(column)) {
    database.exec(`ALTER TABLE registrations ADD COLUMN ${column} ${definition}`);
  }
}
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_event_email
  ON registrations(event_id, email COLLATE NOCASE) WHERE email <> '';
`);

const statements = {
  allEvents: database.prepare(`
    SELECT e.id, e.name, e.date, e.venue, e.category, e.description, e.seats, e.created_at AS createdAt,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
    FROM events e
    ORDER BY e.date ASC, e.name COLLATE NOCASE ASC
  `),
  eventById: database.prepare(`
    SELECT e.id, e.name, e.date, e.venue, e.category, e.description, e.seats, e.created_at AS createdAt,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
    FROM events e WHERE e.id = ?
  `),
  insertEvent: database.prepare(`
    INSERT OR IGNORE INTO events (id, name, date, venue, category, description, seats, created_at)
    VALUES (@id, @name, @date, @venue, @category, @description, @seats, @createdAt)
  `),
  updateEvent: database.prepare(`
    UPDATE events SET name = @name, date = @date, venue = @venue, category = @category,
      description = @description, seats = @seats WHERE id = @id
  `),
  listRegistrations: database.prepare(`
    SELECT r.id, r.event_id AS eventId, r.student, r.registered_at AS registeredAt,
      r.college_name AS collegeName, r.email, r.phone, r.student_id AS studentId,
      r.course_department AS courseDepartment, r.year_of_study AS yearOfStudy,
      e.name AS eventName, e.date AS eventDate
    FROM registrations r JOIN events e ON e.id = r.event_id
    ORDER BY r.registered_at DESC
  `)
};

const purgeExpiredRegistrationsStatement = database.prepare(`
  DELETE FROM registrations
  WHERE event_id IN (
    SELECT id FROM events WHERE date <= date('now', '-29 days')
  )
`);

function importInitialData(savedEvents, savedRegistrations = []) {
  const insertInitialData = database.transaction(() => {
    for (const event of savedEvents) {
      const valid = validateEvent(event);
      if (typeof valid === "string") continue;
      statements.insertEvent.run({
        id: String(event.id || crypto.randomUUID()),
        ...valid,
        createdAt: event.createdAt || new Date().toISOString()
      });
    }

    for (const registration of savedRegistrations) {
      const matchingEvent = savedEvents.find((event) =>
        String(event.id) === String(registration.eventId) || event.name === registration.event
      );
      if (!matchingEvent || typeof registration.student !== "string" || !registration.student.trim()) continue;
      const storedEvent = database.prepare("SELECT id FROM events WHERE id = ?").get(String(matchingEvent.id));
      if (!storedEvent) continue;
      database.prepare("INSERT OR IGNORE INTO registrations (id, event_id, student, registered_at) VALUES (?, ?, ?, ?)")
        .run(crypto.randomUUID(), storedEvent.id, registration.student.trim().slice(0, 120), registration.registeredAt || new Date().toISOString());
    }
  });
  insertInitialData();
}

function initializeDatabase() {
  if (database.prepare("SELECT COUNT(*) AS total FROM events").get().total > 0) return;

  const legacyPath = path.join(DATA_DIR, "events.json");
  if (fs.existsSync(legacyPath)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      if (Array.isArray(legacy.events) && legacy.events.length > 0) {
        importInitialData(legacy.events, Array.isArray(legacy.registrations) ? legacy.registrations : []);
        console.log("Imported data from the previous JSON backend.");
      }
    } catch (error) {
      console.error("Previous JSON data could not be imported:", error.message);
    }
  }

  if (database.prepare("SELECT COUNT(*) AS total FROM events").get().total === 0) {
    const samplePath = path.join(ROOT, "sample-events.json");
    importInitialData(JSON.parse(fs.readFileSync(samplePath, "utf8")));
    console.log("Loaded sample events into the new database.");
  }
}

initializeDatabase();

function seedAdditionalSampleEvents() {
  const migrationId = "sample-events-october-2026-batch-50";
  if (database.prepare("SELECT id FROM app_migrations WHERE id = ?").get(migrationId)) return;

  const additions = JSON.parse(fs.readFileSync(path.join(ROOT, "additional-sample-events.json"), "utf8"));
  if (!Array.isArray(additions) || additions.length !== 50) {
    throw new Error("The October sample-event batch must contain exactly 50 events.");
  }

  const seedBatch = database.transaction(() => {
    for (const event of additions) {
      const valid = validateEvent(event);
      if (typeof valid === "string" || event.date < "2026-10-19" || event.date > "2026-10-30") {
        throw new Error(`Invalid October sample event: ${event.id || "unknown"}`);
      }
      statements.insertEvent.run({
        id: String(event.id),
        ...valid,
        createdAt: new Date().toISOString()
      });
    }
    database.prepare("INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)").run(migrationId, new Date().toISOString());
  });
  seedBatch();
  console.log("Added 50 sample events dated October 19–30, 2026.");
}

seedAdditionalSampleEvents();

function seedAiRoboticsSampleEvents() {
  const migrationId = "sample-events-ai-robotics-batch-20";
  if (database.prepare("SELECT id FROM app_migrations WHERE id = ?").get(migrationId)) return;

  const additions = JSON.parse(fs.readFileSync(path.join(ROOT, "ai-robotics-sample-events.json"), "utf8"));
  const categoryCounts = { AI: 0, Robotics: 0 };
  if (!Array.isArray(additions) || additions.length !== 20) {
    throw new Error("The AI and robotics sample-event batch must contain exactly 20 events.");
  }

  const seedBatch = database.transaction(() => {
    for (const event of additions) {
      const valid = validateEvent(event);
      if (typeof valid === "string" || !Object.hasOwn(categoryCounts, valid.category) || event.date < "2026-10-20") {
        throw new Error(`Invalid AI and robotics sample event: ${event.id || "unknown"}`);
      }
      categoryCounts[valid.category] += 1;
      statements.insertEvent.run({
        id: String(event.id),
        ...valid,
        createdAt: new Date().toISOString()
      });
    }
    if (categoryCounts.AI !== 10 || categoryCounts.Robotics !== 10) {
      throw new Error("The AI and robotics sample-event batch must contain 10 events in each category.");
    }
    database.prepare("INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)").run(migrationId, new Date().toISOString());
  });
  seedBatch();
  console.log("Added 20 sample events across AI and Robotics categories.");
}

seedAiRoboticsSampleEvents();

function purgeExpiredRegistrations() {
  const result = purgeExpiredRegistrationsStatement.run();
  if (result.changes > 0) {
    console.log(`Deleted ${result.changes} registration(s) for events more than 30 days old.`);
  }
}

purgeExpiredRegistrations();
const registrationCleanupTimer = setInterval(() => {
  try {
    purgeExpiredRegistrations();
  } catch (error) {
    console.error("Could not delete expired event registrations:", error);
  }
}, 60 * 60 * 1000);
registrationCleanupTimer.unref();

let aiServiceProcess = null;
let aiServiceStartedByNode = false;

function startPythonAiService() {
  const healthRequest = http.get({ hostname: AI_HOST, port: AI_PORT, path: "/health", timeout: 700 }, (response) => {
    response.resume();
    if (response.statusCode === 200) {
      console.log(`Connected to existing Python AI service at http://${AI_HOST}:${AI_PORT}.`);
      return;
    }
    launchPythonAiService();
  });
  healthRequest.on("timeout", () => healthRequest.destroy());
  healthRequest.on("error", launchPythonAiService);
}

function launchPythonAiService() {
  if (aiServiceProcess) return;
  aiServiceProcess = spawn(PYTHON_COMMAND, [path.join(ROOT, "ai_recommender.py")], {
    cwd: ROOT,
    env: { ...process.env, AI_HOST, AI_PORT: String(AI_PORT) },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true
  });
  aiServiceStartedByNode = true;
  aiServiceProcess.on("error", (error) => {
    console.error(`Could not start Python AI service using '${PYTHON_COMMAND}': ${error.message}`);
    aiServiceProcess = null;
    aiServiceStartedByNode = false;
  });
  aiServiceProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) console.error(`Python AI service exited with code ${code}.`);
    if (signal && signal !== "SIGTERM") console.error(`Python AI service exited after ${signal}.`);
    aiServiceProcess = null;
    aiServiceStartedByNode = false;
  });
}

function stopPythonAiService() {
  if (aiServiceStartedByNode && aiServiceProcess) aiServiceProcess.kill();
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Event details must be an object.";
  const name = cleanText(payload.name, 200);
  const date = cleanText(payload.date, 10);
  const venue = cleanText(payload.venue, 200);
  const category = cleanText(payload.category, 80);
  const description = cleanText(payload.description, 2000);
  const seats = Number(payload.seats);
  if (!name) return "Enter an event name (up to 200 characters).";
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return "Enter a valid event date.";
  if (!venue) return "Enter a venue.";
  if (!Number.isInteger(seats) || seats < 0 || seats > 100000) return "Seats must be a whole number between 0 and 100,000.";
  return { name, date, venue, category, description, seats };
}

function safeEqual(first, second) {
  const left = Buffer.from(first);
  const right = Buffer.from(second);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStatement = db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?");
    this.setStatement = db.prepare("INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires");
    this.deleteStatement = db.prepare("DELETE FROM sessions WHERE sid = ?");
    this.touchStatement = db.prepare("UPDATE sessions SET expires = ? WHERE sid = ?");
    this.cleanupTimer = setInterval(() => {
      db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid);
      if (!row || row.expires <= Date.now()) {
        this.deleteStatement.run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiry = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.setStatement.run(sid, JSON.stringify(sess), expiry);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expiry = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.touchStatement.run(expiry, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.deleteStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

function migrateLegacyJson() {
  const legacyPath = path.join(DATA_DIR, "events.json");
  if (!fs.existsSync(legacyPath) || database.prepare("SELECT COUNT(*) AS total FROM events").get().total > 0) return;
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    if (!Array.isArray(legacy.events)) return;
    const insertEvent = database.transaction((rows) => {
      for (const event of rows) {
        const valid = validateEvent(event);
        if (!valid) continue;
        statements.insertEvent.run({
          id: String(event.id || crypto.randomUUID()), ...valid,
          createdAt: event.createdAt || new Date().toISOString()
        });
      }
      for (const registration of Array.isArray(legacy.registrations) ? legacy.registrations : []) {
        const event = rows.find((item) => String(item.id) === String(registration.eventId) || item.name === registration.event);
        if (event && typeof registration.student === "string" && registration.student.trim()) {
          database.prepare("INSERT OR IGNORE INTO registrations (id, event_id, student, registered_at) VALUES (?, ?, ?, ?)")
            .run(crypto.randomUUID(), String(event.id), registration.student.trim().slice(0, 120), registration.registeredAt || new Date().toISOString());
        }
      }
    });
    insertEvent(legacy.events);
    console.log("Migrated events from the previous JSON data store.");
  } catch (error) {
    console.error("Could not migrate the previous JSON data:", error.message);
  }
}

migrateLegacyJson();

const app = express();
app.disable("x-powered-by");
if (IS_PRODUCTION && process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "32kb", strict: true }));
app.use((request, response, next) => {
  response.set("Cache-Control", request.path.startsWith("/api/") ? "no-store" : "no-cache");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.get("Origin")) {
    const expectedOrigin = `${request.protocol}://${request.get("host")}`;
    if (request.get("Origin") !== expectedOrigin) {
      response.status(403).json({ error: "Cross-origin requests are not allowed." });
      return;
    }
  }
  next();
});

app.use(session({
  name: "campus.events.sid",
  secret: SESSION_SECRET,
  store: new SQLiteSessionStore(database),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait and try again." }
});
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." }
});

function requireOrganizer(request, response, next) {
  if (!request.session.organizer) {
    response.status(401).json({ error: "Organizer sign-in is required." });
    return;
  }
  next();
}

function requireCsrf(request, response, next) {
  const submitted = request.get("X-CSRF-Token") || "";
  const expected = request.session.csrfToken || "";
  if (!submitted || !safeEqual(submitted, expected)) {
    response.status(403).json({ error: "Security token is missing or expired. Refresh the organizer page and try again." });
    return;
  }
  next();
}

function publicEvents(view = "all") {
  const today = new Date().toISOString().slice(0, 10);
  return statements.allEvents.all().filter((event) => {
    const isPast = event.date < today;
    return view === "past" ? isPast : view === "upcoming" ? !isPast : true;
  });
}

app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

app.get("/api/events", (request, response) => {
  const view = ["all", "past", "upcoming"].includes(request.query.view) ? request.query.view : "all";
  response.json({ events: publicEvents(view) });
});

app.post("/api/feedback", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many feedback submissions. Please try again later." }
}), (request, response) => {
  const eventId = cleanText(request.body?.eventId, 100);
  const rating = Number(request.body?.rating);
  const message = cleanText(request.body?.message, 1000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    response.status(400).json({ error: "Choose a rating from 1 to 5." });
    return;
  }
  if (!message) {
    response.status(400).json({ error: "Write a short comment before sending feedback." });
    return;
  }
  if (eventId && !database.prepare("SELECT id FROM events WHERE id = ?").get(eventId)) {
    response.status(400).json({ error: "Choose an event from the list or select general feedback." });
    return;
  }

  database.prepare("INSERT INTO feedback (id, event_id, rating, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), eventId || null, rating, message, new Date().toISOString());
  response.status(201).json({ received: true });
});

app.post("/api/recommendations", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many recommendation requests. Please try again later." }
}), async (request, response) => {
  const interests = cleanText(request.body?.interests, 300);
  const minScore = request.body?.minScore === undefined ? 0 : request.body.minScore;
  const dateFrom = cleanText(request.body?.dateFrom, 10);
  const dateTo = cleanText(request.body?.dateTo, 10);
  const timeOfDay = request.body?.timeOfDay === undefined ? "any" : request.body.timeOfDay;
  if (!interests) {
    response.status(400).json({ error: "Enter a few topics you are interested in." });
    return;
  }
  if (!Number.isInteger(minScore) || minScore < 0 || minScore > 100) {
    response.status(400).json({ error: "Minimum text-match score must be a whole number from 0 to 100." });
    return;
  }
  if ((dateFrom && !isValidDate(dateFrom)) || (dateTo && !isValidDate(dateTo))) {
    response.status(400).json({ error: "Enter valid start and end dates." });
    return;
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    response.status(400).json({ error: "The end date must be the same as or later than the start date." });
    return;
  }
  if (!["any", "morning", "afternoon", "evening"].includes(timeOfDay)) {
    response.status(400).json({ error: "Choose any time, morning, afternoon, or evening." });
    return;
  }

  const body = JSON.stringify({
    interests,
    minScore,
    dateFrom,
    dateTo,
    timeOfDay,
    events: publicEvents("upcoming")
  });
  const proxyRequest = http.request({
    hostname: AI_HOST,
    port: AI_PORT,
    path: "/recommend",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout: 5000
  }, (aiResponse) => {
    let responseBody = "";
    aiResponse.setEncoding("utf8");
    aiResponse.on("data", (chunk) => {
      responseBody += chunk;
      if (responseBody.length > 256 * 1024) proxyRequest.destroy(new Error("AI response too large."));
    });
    aiResponse.on("end", () => {
      try {
        const result = JSON.parse(responseBody || "{}");
        response.status(aiResponse.statusCode || 502).json(result);
      } catch {
        response.status(502).json({ error: "The recommendation service returned an invalid response." });
      }
    });
  });

  proxyRequest.on("timeout", () => proxyRequest.destroy(new Error("Recommendation request timed out.")));
  proxyRequest.on("error", (error) => {
    console.error("Python recommendation service request failed:", error.message);
    if (!response.headersSent) response.status(503).json({ error: "AI recommendations are temporarily unavailable. Please try again shortly." });
  });
  proxyRequest.end(body);
});

app.post("/api/organizer/ai/event-copy", requireOrganizer, requireCsrf, rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many AI writing requests. Please try again later." }
}), (request, response) => {
  const payload = {
    name: cleanText(request.body?.name, 200),
    category: cleanText(request.body?.category, 80),
    details: cleanText(request.body?.details, 1000),
    audience: cleanText(request.body?.audience, 120)
  };
  if (!payload.name) {
    response.status(400).json({ error: "Enter an event name before drafting its description." });
    return;
  }

  const body = JSON.stringify(payload);
  const proxyRequest = http.request({
    hostname: AI_HOST,
    port: AI_PORT,
    path: "/draft-event",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout: 5000
  }, (aiResponse) => {
    let responseBody = "";
    aiResponse.setEncoding("utf8");
    aiResponse.on("data", (chunk) => {
      responseBody += chunk;
      if (responseBody.length > 32 * 1024) proxyRequest.destroy(new Error("AI response too large."));
    });
    aiResponse.on("end", () => {
      try {
        response.status(aiResponse.statusCode || 502).json(JSON.parse(responseBody || "{}"));
      } catch {
        response.status(502).json({ error: "The event-copy service returned an invalid response." });
      }
    });
  });

  proxyRequest.on("timeout", () => proxyRequest.destroy(new Error("AI writing request timed out.")));
  proxyRequest.on("error", (error) => {
    console.error("Python event-copy request failed:", error.message);
    if (!response.headersSent) response.status(503).json({ error: "The Python writing assistant is unavailable. Check that the AI service is running." });
  });
  proxyRequest.end(body);
});

app.get("/api/auth/me", (request, response) => {
  response.json({ authenticated: Boolean(request.session.organizer), csrfToken: request.session.organizer ? request.session.csrfToken : null });
});

app.post("/api/auth/login", loginLimiter, (request, response, next) => {
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!safeEqual(password, ORGANIZER_PASSWORD)) {
    response.status(401).json({ error: "Incorrect organizer password." });
    return;
  }
  request.session.regenerate((error) => {
    if (error) return next(error);
    request.session.organizer = true;
    request.session.csrfToken = crypto.randomBytes(32).toString("hex");
    request.session.save((saveError) => {
      if (saveError) return next(saveError);
      response.json({ authenticated: true, csrfToken: request.session.csrfToken });
    });
  });
});

app.post("/api/auth/logout", requireOrganizer, requireCsrf, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie("campus.events.sid", { httpOnly: true, sameSite: "strict", secure: IS_PRODUCTION });
    response.json({ loggedOut: true });
  });
});

app.get("/api/organizer/registrations", requireOrganizer, (_request, response) => {
  response.json({ registrations: statements.listRegistrations.all() });
});

app.post("/api/events", requireOrganizer, requireCsrf, (request, response) => {
  const event = validateEvent(request.body);
  if (typeof event === "string") {
    response.status(400).json({ error: event });
    return;
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  statements.insertEvent.run({ id, ...event, createdAt });
  response.status(201).json({ event: statements.eventById.get(id) });
});

app.put("/api/events/:id", requireOrganizer, requireCsrf, (request, response) => {
  const event = validateEvent(request.body);
  if (typeof event === "string") {
    response.status(400).json({ error: event });
    return;
  }
  const updated = statements.updateEvent.run({ id: request.params.id, ...event });
  if (updated.changes === 0) {
    response.status(404).json({ error: "Event not found." });
    return;
  }
  response.json({ event: statements.eventById.get(request.params.id) });
});

app.delete("/api/events/:id", requireOrganizer, requireCsrf, (request, response) => {
  const result = database.prepare("DELETE FROM events WHERE id = ?").run(request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: "Event not found." });
    return;
  }
  response.json({ deleted: true });
});

app.delete("/api/registrations/:id", requireOrganizer, requireCsrf, (request, response) => {
  const removeRegistration = database.transaction((id) => {
    const registration = database.prepare("SELECT event_id AS eventId FROM registrations WHERE id = ?").get(id);
    if (!registration) return false;
    database.prepare("DELETE FROM registrations WHERE id = ?").run(id);
    database.prepare("UPDATE events SET seats = seats + 1 WHERE id = ?").run(registration.eventId);
    return true;
  });
  if (!removeRegistration(request.params.id)) {
    response.status(404).json({ error: "Registration not found." });
    return;
  }
  response.json({ deleted: true });
});

app.post("/api/events/:id/register", registrationLimiter, (request, response) => {
  const student = cleanText(request.body?.student, 120);
  const collegeName = cleanText(request.body?.collegeName, 200);
  const email = cleanText(request.body?.email, 254).toLowerCase();
  const phone = cleanText(request.body?.phone, 40);
  const studentId = cleanText(request.body?.studentId, 80);
  const courseDepartment = cleanText(request.body?.courseDepartment, 120);
  const yearOfStudy = cleanText(request.body?.yearOfStudy, 40);
  const privacyAcknowledged = request.body?.privacyAcknowledged === true;
  const validYears = ["1st year", "2nd year", "3rd year", "4th year", "5th year", "Postgraduate", "Other"];
  if (!student) {
    response.status(400).json({ error: "Enter your full name (up to 120 characters)." });
    return;
  }
  if (!collegeName) {
    response.status(400).json({ error: "Enter your college name." });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (yearOfStudy && !validYears.includes(yearOfStudy)) {
    response.status(400).json({ error: "Choose a valid year of study." });
    return;
  }
  if (!privacyAcknowledged) {
    response.status(400).json({ error: "Acknowledge how your registration details will be used before continuing." });
    return;
  }

  const register = database.transaction(() => {
    const event = database.prepare("SELECT id, name, date, venue, category, description, seats FROM events WHERE id = ?").get(request.params.id);
    if (!event) return { status: 404, error: "Event not found." };
    if (event.date < new Date().toISOString().slice(0, 10)) return { status: 400, error: "Registration for this event is closed." };
    if (event.seats < 1) return { status: 409, error: "This event is fully booked." };
    const duplicate = database.prepare(`
      SELECT id FROM registrations
      WHERE event_id = ? AND (student = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)
    `).get(event.id, student, email);
    if (duplicate) return { status: 409, error: "This name or email is already registered for the event." };

    const update = database.prepare("UPDATE events SET seats = seats - 1 WHERE id = ? AND seats > 0").run(event.id);
    if (!update.changes) return { status: 409, error: "This event is fully booked." };
    database.prepare(`
      INSERT INTO registrations (
        id, event_id, student, college_name, email, phone, student_id,
        course_department, year_of_study, registered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), event.id, student, collegeName, email, phone,
      studentId, courseDepartment, yearOfStudy, new Date().toISOString()
    );
    return { status: 201, event: statements.eventById.get(event.id) };
  });

  const result = register();
  if (result.error) {
    response.status(result.status).json({ error: result.error });
    return;
  }
  response.status(result.status).json({ event: result.event });
});

const PUBLIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/past-events.html": "past-events.html",
  "/upcoming-events.html": "upcoming-events.html",
  "/sponsorship.html": "sponsorship.html",
  "/feedback.html": "feedback.html",
  "/organizer.html": "organizer.html",
  "/registration.html": "registration.html",
  "/style.css": "style.css",
  "/script.js": "script.js",
  "/feedback.js": "feedback.js",
  "/organizer.js": "organizer.js",
  "/registration.js": "registration.js",
  "/assets/event-images/technology.jpg": "assets/event-images/technology.jpg",
  "/assets/event-images/performance.jpg": "assets/event-images/performance.jpg",
  "/assets/event-images/movement.jpg": "assets/event-images/movement.jpg",
  "/assets/event-images/creative.jpg": "assets/event-images/creative.jpg",
  "/assets/event-images/nature.jpg": "assets/event-images/nature.jpg"
};

app.get(Object.keys(PUBLIC_FILES), (request, response, next) => {
  response.sendFile(path.join(ROOT, PUBLIC_FILES[request.path]), (error) => {
    if (error) next(error);
  });
});

app.use("/api", (_request, response) => response.status(404).json({ error: "API endpoint not found." }));
app.use((_request, response) => response.status(404).send("Page not found."));
app.use((error, _request, response, _next) => {
  console.error("Request failed:", error);
  if (response.headersSent) return;
  if (error.type === "entity.parse.failed") {
    response.status(400).json({ error: "Request body must contain valid JSON." });
    return;
  }
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    response.status(409).json({ error: "This name or email is already registered for the event." });
    return;
  }
  response.status(500).json({ error: "The server could not complete the request." });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`College Event Manager is running at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DATABASE_FILE}`);
  if (IS_PRODUCTION) console.log("Production security settings enabled.");
  startPythonAiService();
});

function shutdown() {
  server.close(() => {
    stopPythonAiService();
    database.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
