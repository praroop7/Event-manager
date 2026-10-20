const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const Database = require("better-sqlite3");

const ROOT = __dirname;
let tempDirectory;
let databaseFile;
let aiHealthServer;
let serverEnvironment;
let appProcess;
let appBaseUrl;
let organizerPassword;
let serverOutput = "";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function getAvailablePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForApp() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Event server exited before starting.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${appBaseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Event server did not become ready.\n${serverOutput}`);
}

async function startApp() {
  const appPort = await getAvailablePort();
  appBaseUrl = `http://127.0.0.1:${appPort}`;
  appProcess = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...serverEnvironment, PORT: String(appPort) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  appProcess.stdout.setEncoding("utf8").on("data", (chunk) => { serverOutput += chunk; });
  appProcess.stderr.setEncoding("utf8").on("data", (chunk) => { serverOutput += chunk; });
  await waitForApp();
}

async function stopApp() {
  if (!appProcess || appProcess.exitCode !== null) return;
  const currentProcess = appProcess;
  const exited = new Promise((resolve) => currentProcess.once("exit", resolve));
  currentProcess.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref();
    })
  ]);
  if (currentProcess.exitCode === null) {
    currentProcess.kill();
    await exited;
  }
}

async function apiRequest(route, { method = "GET", body, cookie, csrfToken } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`${appBaseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

before(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "college-event-manager-tests-"));
  databaseFile = path.join(tempDirectory, "test.sqlite");
  aiHealthServer = http.createServer((request, response) => {
    response.writeHead(request.url === "/health" ? 200 : 404);
    response.end();
  });
  const aiPort = await listen(aiHealthServer);
  organizerPassword = `test-${crypto.randomBytes(20).toString("hex")}`;

  serverEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    EVENT_DATABASE_FILE: databaseFile,
    ORGANIZER_PASSWORD: organizerPassword,
    SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
    AI_HOST: "127.0.0.1",
    AI_PORT: String(aiPort)
  };
  await startApp();
});

after(async () => {
  await stopApp();
  if (aiHealthServer?.listening) {
    await new Promise((resolve, reject) => {
      aiHealthServer.close((error) => error ? reject(error) : resolve());
    });
  }
  if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
});

test("event publishing and registration preserve validation, privacy, and seat counts", async () => {
  const unauthorized = await apiRequest("/api/events", {
    method: "POST",
    body: { name: "Unauthorized event" }
  });
  assert.equal(unauthorized.status, 401, "publishing requires an organizer session");

  const login = await apiRequest("/api/auth/login", {
    method: "POST",
    body: { password: organizerPassword }
  });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  assert.ok(login.body.csrfToken);

  const organizer = { cookie: login.cookie, csrfToken: login.body.csrfToken };
  const invalidEvent = await apiRequest("/api/events", {
    method: "POST",
    ...organizer,
    body: { name: "Missing required event details" }
  });
  assert.equal(invalidEvent.status, 400, "invalid events are rejected");

  const eventDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const published = await apiRequest("/api/events", {
    method: "POST",
    ...organizer,
    body: {
      name: "Registration integration test",
      date: eventDate,
      venue: "Test Hall",
      category: "Testing",
      description: "An isolated event created by the integration test.",
      seats: 1
    }
  });
  assert.equal(published.status, 201);
  const eventId = published.body.event.id;

  const updated = await apiRequest(`/api/events/${encodeURIComponent(eventId)}`, {
    method: "PUT",
    ...organizer,
    body: {
      name: "Updated registration integration test",
      date: eventDate,
      venue: "Updated Test Hall",
      category: "Testing",
      description: "Updated details.",
      seats: 1
    }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.event.name, "Updated registration integration test");

  const publicList = await apiRequest("/api/events?view=upcoming");
  assert.equal(publicList.status, 200);
  const publicEvent = publicList.body.events.find((event) => event.id === eventId);
  assert.ok(publicEvent, "published event is visible in the upcoming list");
  assert.equal(Object.hasOwn(publicEvent, "email"), false, "public event listing does not expose registration details");

  const registrationRoute = `/api/events/${encodeURIComponent(eventId)}/register`;
  const invalidRegistration = await apiRequest(registrationRoute, {
    method: "POST",
    body: { student: "Test Student", collegeName: "Example College", email: "not-an-email", privacyAcknowledged: true }
  });
  assert.equal(invalidRegistration.status, 400, "required registration details are validated");

  const unacknowledged = await apiRequest(registrationRoute, {
    method: "POST",
    body: {
      student: "Test Student",
      collegeName: "Example College",
      email: `unacknowledged-${crypto.randomUUID()}@example.test`
    }
  });
  assert.equal(unacknowledged.status, 400, "registration requires acknowledgement of the privacy notice");
  assert.match(unacknowledged.body.error, /acknowledge/i);

  const applicants = [
    { student: "Test Student One", email: `one-${crypto.randomUUID()}@example.test` },
    { student: "Test Student Two", email: `two-${crypto.randomUUID()}@example.test` }
  ];
  const registrationResults = await Promise.all(applicants.map(({ student, email }) => apiRequest(registrationRoute, {
    method: "POST",
    body: {
      student,
      collegeName: "Example College",
      email,
      phone: "555-0100",
      studentId: "TEST-100",
      courseDepartment: "Computer Science",
      yearOfStudy: "2nd year",
      privacyAcknowledged: true
    }
  })));
  const registration = registrationResults.find((result) => result.status === 201);
  const overbooked = registrationResults.find((result) => result.status === 409);
  assert.ok(registration, "one concurrent registration succeeds");
  assert.ok(overbooked, "one concurrent registration is rejected");
  assert.equal(registration.body.event.seats, 0, "successful registration consumes the only seat");
  assert.equal(registration.body.event.registered, 1, "concurrent registration does not oversell");
  const acceptedApplicant = applicants[registrationResults.findIndex((result) => result.status === 201)];

  const duplicate = await apiRequest(registrationRoute, {
    method: "POST",
    body: {
      student: "Another Student",
      collegeName: "Example College",
      email: acceptedApplicant.email.toUpperCase(),
      privacyAcknowledged: true
    }
  });
  assert.equal(duplicate.status, 409, "duplicate email registration is rejected case-insensitively");

  const full = await apiRequest(registrationRoute, {
    method: "POST",
    body: {
      student: "Student Without A Seat",
      collegeName: "Example College",
      email: `full-${crypto.randomUUID()}@example.test`,
      privacyAcknowledged: true
    }
  });
  assert.equal(full.status, 409, "registration is rejected when an event is full");
  assert.match(full.body.error, /fully booked/i);

  const privateWithoutSession = await apiRequest("/api/organizer/registrations");
  assert.equal(privateWithoutSession.status, 401, "registration details require organizer authentication");
  const organizerRegistrations = await apiRequest("/api/organizer/registrations", organizer);
  assert.equal(organizerRegistrations.status, 200);
  const savedRegistration = organizerRegistrations.body.registrations.find((item) => item.eventId === eventId);
  assert.ok(savedRegistration);
  assert.equal(savedRegistration.student, acceptedApplicant.student);
  assert.equal(savedRegistration.collegeName, "Example College");
  assert.equal(savedRegistration.email, acceptedApplicant.email);
  assert.equal(savedRegistration.phone, "555-0100");
  assert.equal(savedRegistration.studentId, "TEST-100");
  assert.equal(savedRegistration.courseDepartment, "Computer Science");
  assert.equal(savedRegistration.yearOfStudy, "2nd year");

  const removedRegistration = await apiRequest(
    `/api/registrations/${encodeURIComponent(savedRegistration.id)}`,
    { method: "DELETE", ...organizer }
  );
  assert.equal(removedRegistration.status, 200);
  const reopenedEvent = await apiRequest("/api/events?view=upcoming");
  const eventWithReturnedSeat = reopenedEvent.body.events.find((event) => event.id === eventId);
  assert.equal(eventWithReturnedSeat.seats, 1, "removing a registration returns the seat");
  assert.equal(eventWithReturnedSeat.registered, 0);

  const deletedEvent = await apiRequest(`/api/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    ...organizer
  });
  assert.equal(deletedEvent.status, 200);
  const finalList = await apiRequest("/api/events?view=upcoming");
  assert.equal(finalList.body.events.some((event) => event.id === eventId), false);

  const database = new Database(databaseFile);
  const expiredEventId = crypto.randomUUID();
  const oldEventDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  database.prepare(`
    INSERT INTO events (id, name, date, venue, category, description, seats, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(expiredEventId, "Expired retention test event", oldEventDate, "Test Hall", "Testing", "", 0, new Date().toISOString());
  database.prepare(`
    INSERT INTO registrations (id, event_id, student, registered_at, college_name, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), expiredEventId, "Expired Test Student", new Date().toISOString(), "Example College", "expired@example.test");
  database.close();

  await stopApp();
  await startApp();
  const restartedLogin = await apiRequest("/api/auth/login", {
    method: "POST",
    body: { password: organizerPassword }
  });
  assert.equal(restartedLogin.status, 200);
  const afterRetentionPurge = await apiRequest("/api/organizer/registrations", {
    cookie: restartedLogin.cookie
  });
  assert.equal(afterRetentionPurge.status, 200);
  assert.equal(
    afterRetentionPurge.body.registrations.some((item) => item.eventId === expiredEventId),
    false,
    "registrations for events more than 30 days old are purged when the server starts"
  );
});

test("serves local organizer event thumbnail assets", async () => {
  for (const category of ["technology", "performance", "movement", "creative", "nature"]) {
    const response = await fetch(`${appBaseUrl}/assets/event-images/${category}.jpg`);
    assert.equal(response.status, 200, `${category} thumbnail is available`);
    assert.match(response.headers.get("content-type") || "", /^image\/jpeg\b/);
    assert.ok((await response.arrayBuffer()).byteLength > 10_000, `${category} thumbnail is a real image`);
  }
});
