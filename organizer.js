const loginPanel = document.getElementById("loginPanel");
const dashboardPanel = document.getElementById("dashboardPanel");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const eventForm = document.getElementById("organizerEventForm");
const editorMessage = document.getElementById("editorMessage");
const managedEvents = document.getElementById("managedEvents");
const registrationsBody = document.getElementById("organizerRegistrations");
const registrationTableWrap = document.querySelector(".registration-table-wrap");
const registrationEmpty = document.getElementById("registrationEmpty");
const eventIdInput = document.getElementById("eventId");
const organizerWorkspaceNav = document.querySelector(".organizer-workspace-nav");
const organizerOverview = document.querySelector(".organizer-overview");
let csrfToken = "";
let events = [];
let registrations = [];

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/auth/login") showLogin();
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("message-error", isError);
  element.classList.toggle("message-success", Boolean(message) && !isError);
}

function showLogin(message = "") {
  csrfToken = "";
  loginPanel.hidden = false;
  dashboardPanel.hidden = true;
  if (message) setMessage(loginMessage, message, true);
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboardPanel.hidden = false;
  setMessage(loginMessage, "");
}

function makeNode(tag, className = "", value = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function formatDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat(undefined, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function renderStats() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("statEvents").textContent = String(events.length);
  document.getElementById("statUpcoming").textContent = String(events.filter((event) => event.date >= today).length);
  document.getElementById("statRegistrations").textContent = String(registrations.length);
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, value));
  return element;
}

function makeEventArtwork(event) {
  const category = `${event.category || ""} ${event.name || ""} ${event.description || ""}`.toLowerCase();
  const artType = /robot|artificial|(^|\W)ai(\W|$)|tech/.test(category) ? "technology"
    : /music|culture|dance|performance|concert|festival|comedy|open mic|talent/.test(category) ? "performance"
      : /sport|fitness|wellness|basketball|football|yoga/.test(category) ? "movement"
        : /art|design|photo|painting|craft|creative/.test(category) ? "creative"
          : /environment|sustain|garden|volunteer|nature|climate|green/.test(category) ? "nature"
            : "campus";
  const artwork = makeNode("div", `managed-event-art managed-event-art--${artType}`);
  const image = document.createElement("img");
  const imageType = artType === "campus" ? "performance" : artType;
  image.src = `/assets/event-images/${imageType}.jpg`;
  image.alt = `Representative ${event.category || "campus"} event photo for ${event.name || "this event"}`;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => artwork.classList.add("is-fallback"), { once: true });
  artwork.appendChild(image);

  const svg = svgElement("svg", { viewBox: "0 0 320 180", preserveAspectRatio: "xMidYMid slice", focusable: "false" });
  svg.setAttribute("aria-hidden", "true");
  svg.appendChild(svgElement("rect", { class: "art-backdrop", width: "320", height: "180", rx: "18" }));
  svg.appendChild(svgElement("circle", { class: "art-orbit", cx: "254", cy: "47", r: "43" }));
  svg.appendChild(svgElement("path", { class: "art-horizon", d: "M0 137Q64 96 128 137T256 137T384 137V180H0Z" }));

  if (artType === "technology") {
    svg.append(
      svgElement("path", { class: "art-line", d: "M66 50h63v35h56v38m-119-38v44h118m-59-79v-18h72" }),
      svgElement("rect", { class: "art-device", x: "44", y: "32", width: "44", height: "40", rx: "9" }),
      svgElement("rect", { class: "art-device", x: "166", y: "108", width: "44", height: "35", rx: "9" }),
      svgElement("circle", { class: "art-node", cx: "129", cy: "50", r: "6" }),
      svgElement("circle", { class: "art-node", cx: "185", cy: "85", r: "6" }),
      svgElement("circle", { class: "art-node", cx: "256", cy: "32", r: "6" })
    );
  } else if (artType === "performance") {
    svg.append(
      svgElement("circle", { class: "art-disc", cx: "160", cy: "89", r: "48" }),
      svgElement("circle", { class: "art-disc-ring", cx: "160", cy: "89", r: "31" }),
      svgElement("circle", { class: "art-disc-center", cx: "160", cy: "89", r: "9" }),
      svgElement("path", { class: "art-line", d: "M65 133h190M82 120h156M102 107h116" }),
      svgElement("path", { class: "art-spark", d: "M70 49l4 11 11 4-11 4-4 11-4-11-11-4 11-4zm180 10 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" })
    );
  } else if (artType === "movement") {
    svg.append(
      svgElement("circle", { class: "art-ball", cx: "161", cy: "91", r: "43" }),
      svgElement("path", { class: "art-ball-line", d: "M126 67q35 17 70 0m-70 48q35-17 70 0m-36-67q-19 43 0 86m0-86q19 43 0 86" }),
      svgElement("path", { class: "art-spark", d: "M77 48l4 11 11 4-11 4-4 11-4-11-11-4 11-4zm164 73 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" })
    );
  } else if (artType === "creative") {
    svg.append(
      svgElement("path", { class: "art-canvas", d: "M79 41h162v102H79z" }),
      svgElement("circle", { class: "art-sun", cx: "194", cy: "72", r: "18" }),
      svgElement("path", { class: "art-mountain", d: "M91 128l39-44 25 27 26-34 47 51z" }),
      svgElement("path", { class: "art-line", d: "M64 149h195" }),
      svgElement("circle", { class: "art-node", cx: "83", cy: "35", r: "5" })
    );
  } else if (artType === "nature") {
    svg.append(
      svgElement("path", { class: "art-stem", d: "M160 137V77m0 28q-45 2-51-39 38-1 51 30m0-7q40 0 51-39-36-2-51 29" }),
      svgElement("path", { class: "art-leaf", d: "M109 66q38-4 51 30-37 5-51-30zm51 23q12-34 51-29-9 36-51 29z" }),
      svgElement("circle", { class: "art-orbit", cx: "160", cy: "76", r: "57" }),
      svgElement("path", { class: "art-line", d: "M91 144h138" })
    );
  } else {
    svg.append(
      svgElement("path", { class: "art-building", d: "M79 139V78l81-43 81 43v61z" }),
      svgElement("path", { class: "art-building-inner", d: "M99 139V86l61-33 61 33v53z" }),
      svgElement("path", { class: "art-line", d: "M132 139V99h56v40m-84-51h112m-44 51V99" }),
      svgElement("circle", { class: "art-node", cx: "160", cy: "77", r: "8" })
    );
  }

  artwork.appendChild(svg);
  return artwork;
}

function renderEvents() {
  managedEvents.setAttribute("aria-busy", "false");
  managedEvents.replaceChildren();
  if (events.length === 0) {
    managedEvents.appendChild(makeNode("p", "empty", "No events yet. Create your first event above."));
    return;
  }

  events.forEach((event) => {
    const card = makeNode("article", "managed-event");
    card.appendChild(makeEventArtwork(event));
    const details = makeNode("div", "managed-event-copy");
    details.append(
      makeNode("p", "managed-event-category", event.category || "EVENT"),
      makeNode("h3", "", event.name),
      makeNode("p", "managed-event-meta", `📅 ${formatDate(`${event.date}T00:00:00`)}`),
      makeNode("p", "managed-event-meta", `📍 ${event.venue}`),
      makeNode("p", "managed-event-description", event.description || "No description added.")
    );
    const stats = makeNode("div", "managed-event-stats");
    stats.append(
      makeNode("strong", "", String(event.seats)),
      makeNode("span", "", "seats available"),
      makeNode("span", "", `${event.registered || 0} registered`)
    );
    const actions = makeNode("div", "managed-event-actions");
    const editButton = makeNode("button", "quiet-button", "Edit");
    editButton.type = "button";
    editButton.addEventListener("click", () => startEditing(event));
    const deleteButton = makeNode("button", "danger", "Delete");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => removeEvent(event));
    actions.append(editButton, deleteButton);
    card.append(details, stats, actions);
    managedEvents.appendChild(card);
  });
}

function renderRegistrations() {
  registrationsBody.setAttribute("aria-busy", "false");
  registrationTableWrap.setAttribute("aria-busy", "false");
  registrationsBody.replaceChildren();
  registrationEmpty.hidden = registrations.length > 0;
  registrationTableWrap.hidden = registrations.length === 0;

  registrations.forEach((registration) => {
    const row = document.createElement("tr");
    const contact = [registration.email, registration.phone].filter(Boolean).join(" · ") || "—";
    const studyDetails = [
      registration.studentId && `ID: ${registration.studentId}`,
      registration.courseDepartment,
      registration.yearOfStudy
    ].filter(Boolean).join(" · ") || "—";
    row.append(
      makeNode("td", "", registration.student),
      makeNode("td", "", registration.collegeName || "—"),
      makeNode("td", "registration-detail-cell", contact),
      makeNode("td", "registration-detail-cell", studyDetails),
      makeNode("td", "", registration.eventName),
      makeNode("td", "", formatDate(`${registration.eventDate}T00:00:00`)),
      makeNode("td", "", formatDate(registration.registeredAt, true))
    );
    const actions = document.createElement("td");
    const cancelButton = makeNode("button", "table-action", "Remove");
    cancelButton.type = "button";
    cancelButton.setAttribute("aria-label", `Remove ${registration.student}'s registration for ${registration.eventName}`);
    cancelButton.addEventListener("click", () => removeRegistration(registration));
    actions.appendChild(cancelButton);
    row.appendChild(actions);
    registrationsBody.appendChild(row);
  });
}

if (organizerOverview && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const overviewCards = organizerOverview.querySelectorAll(".organizer-stats article");
  let tiltFrame = 0;

  organizerOverview.addEventListener("pointermove", (event) => {
    if (tiltFrame) return;
    tiltFrame = window.requestAnimationFrame(() => {
      tiltFrame = 0;
      const bounds = organizerOverview.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      organizerOverview.style.setProperty("--overview-tilt-x", `${(0.5 - y) * 3}deg`);
      organizerOverview.style.setProperty("--overview-tilt-y", `${(x - 0.5) * 4}deg`);
      organizerOverview.style.setProperty("--overview-glow-x", `${x * 100}%`);
      organizerOverview.style.setProperty("--overview-glow-y", `${y * 100}%`);

      const activeCard = event.target instanceof Element
        ? event.target.closest(".organizer-stats article")
        : null;
      overviewCards.forEach((card) => {
        if (card !== activeCard) {
          card.style.removeProperty("--card-tilt-x");
          card.style.removeProperty("--card-tilt-y");
          return;
        }
        const cardBounds = card.getBoundingClientRect();
        const cardX = Math.min(1, Math.max(0, (event.clientX - cardBounds.left) / cardBounds.width));
        const cardY = Math.min(1, Math.max(0, (event.clientY - cardBounds.top) / cardBounds.height));
        card.style.setProperty("--card-tilt-x", `${(0.5 - cardY) * 8}deg`);
        card.style.setProperty("--card-tilt-y", `${(cardX - 0.5) * 9}deg`);
      });
    });
  });

  organizerOverview.addEventListener("pointerleave", () => {
    if (tiltFrame) {
      window.cancelAnimationFrame(tiltFrame);
      tiltFrame = 0;
    }
    organizerOverview.style.removeProperty("--overview-tilt-x");
    organizerOverview.style.removeProperty("--overview-tilt-y");
    organizerOverview.style.removeProperty("--overview-glow-x");
    organizerOverview.style.removeProperty("--overview-glow-y");
    overviewCards.forEach((card) => {
      card.style.removeProperty("--card-tilt-x");
      card.style.removeProperty("--card-tilt-y");
    });
  });
}

async function loadDashboard() {
  managedEvents.setAttribute("aria-busy", "true");
  registrationTableWrap.setAttribute("aria-busy", "true");
  try {
    const [eventResult, registrationResult] = await Promise.all([
      apiRequest("/api/events"),
      apiRequest("/api/organizer/registrations")
    ]);
    events = eventResult.events;
    registrations = registrationResult.registrations;
    renderStats();
    renderEvents();
    renderRegistrations();
  } finally {
    managedEvents.setAttribute("aria-busy", "false");
    registrationTableWrap.setAttribute("aria-busy", "false");
  }
}

function resetEditor() {
  eventForm.reset();
  eventIdInput.value = "";
  document.getElementById("eventSeats").value = "50";
  document.getElementById("eventEditorTitle").textContent = "Create an event";
  document.getElementById("saveEventButton").textContent = "Publish event";
  document.getElementById("cancelEditButton").hidden = true;
  setMessage(editorMessage, "");
}

function startEditing(event) {
  eventIdInput.value = event.id;
  document.getElementById("eventName").value = event.name;
  document.getElementById("eventDate").value = event.date;
  document.getElementById("eventVenue").value = event.venue;
  document.getElementById("eventCategory").value = event.category || "";
  document.getElementById("eventDescription").value = event.description || "";
  document.getElementById("eventSeats").value = event.seats;
  document.getElementById("eventEditorTitle").textContent = "Update event details";
  document.getElementById("saveEventButton").textContent = "Save changes";
  document.getElementById("cancelEditButton").hidden = false;
  document.getElementById("eventEditorTitle").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function removeEvent(event) {
  if (!confirm(`Delete “${event.name}” and all of its registrations? This cannot be undone.`)) return;
  try {
    await apiRequest(`/api/events/${encodeURIComponent(event.id)}`, { method: "DELETE" });
    await loadDashboard();
    setMessage(editorMessage, `${event.name} was deleted.`);
  } catch (error) {
    setMessage(editorMessage, error.message, true);
  }
}

async function removeRegistration(registration) {
  if (!confirm(`Remove ${registration.student}'s registration for ${registration.eventName}?`)) return;
  try {
    await apiRequest(`/api/registrations/${encodeURIComponent(registration.id)}`, { method: "DELETE" });
    await loadDashboard();
    setMessage(editorMessage, "Registration removed and one seat returned.");
  } catch (error) {
    setMessage(editorMessage, error.message, true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordInput = document.getElementById("organizerPassword");
  const submitButton = loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setMessage(loginMessage, "Signing in…");
  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value })
    });
    csrfToken = result.csrfToken;
    passwordInput.value = "";
    showDashboard();
    await loadDashboard();
  } catch (error) {
    setMessage(loginMessage, error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = document.getElementById("saveEventButton");
  saveButton.disabled = true;
  const payload = {
    name: document.getElementById("eventName").value.trim(),
    date: document.getElementById("eventDate").value,
    venue: document.getElementById("eventVenue").value.trim(),
    category: document.getElementById("eventCategory").value.trim(),
    description: document.getElementById("eventDescription").value.trim(),
    seats: Number(document.getElementById("eventSeats").value)
  };
  const id = eventIdInput.value;
  try {
    await apiRequest(id ? `/api/events/${encodeURIComponent(id)}` : "/api/events", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    resetEditor();
    await loadDashboard();
    setMessage(editorMessage, id ? "Event details were updated." : "Event published successfully.");
  } catch (error) {
    setMessage(editorMessage, error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

organizerWorkspaceNav.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#']");
  if (!link) return;
  organizerWorkspaceNav.querySelectorAll("a").forEach((navLink) => {
    if (navLink === link) navLink.setAttribute("aria-current", "location");
    else navLink.removeAttribute("aria-current");
  });
});

document.getElementById("cancelEditButton").addEventListener("click", resetEditor);
document.getElementById("draftCopyButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const eventName = document.getElementById("eventName").value.trim();
  const categoryInput = document.getElementById("eventCategory");
  const descriptionInput = document.getElementById("eventDescription");
  const checklist = document.getElementById("aiCopyChecklist");
  const message = document.getElementById("aiCopyMessage");

  if (!eventName) {
    setMessage(message, "Add an event name first, then ask AI for a draft.", true);
    document.getElementById("eventName").focus();
    return;
  }

  button.disabled = true;
  checklist.replaceChildren();
  checklist.hidden = true;
  setMessage(message, "Classifying the event and drafting copy…");
  try {
    const result = await apiRequest("/api/organizer/ai/event-copy", {
      method: "POST",
      body: JSON.stringify({
        name: eventName,
        category: categoryInput.value.trim(),
        details: descriptionInput.value.trim(),
        audience: document.getElementById("eventAudience").value.trim()
      })
    });

    descriptionInput.value = result.description;
    if (!categoryInput.value.trim() && result.suggestedCategory) {
      categoryInput.value = result.suggestedCategory;
    }
    (result.checklist || []).forEach((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      checklist.appendChild(listItem);
    });
    checklist.hidden = checklist.childElementCount === 0;
    const confidence = result.categoryConfidence > 0
      ? ` Suggested category: ${result.suggestedCategory} (${Math.round(result.categoryConfidence * 100)}% topic match).`
      : " No strong category match was found; choose one manually if needed.";
    setMessage(message, `${result.notice}${confidence}`);
  } catch (error) {
    setMessage(message, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("refreshButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await loadDashboard();
    setMessage(editorMessage, "Dashboard is up to date.");
  } catch (error) {
    setMessage(editorMessage, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
    showLogin("You have been signed out.");
  } catch (error) {
    setMessage(editorMessage, error.message, true);
  }
});

(async function initializeOrganizer() {
  try {
    const sessionState = await apiRequest("/api/auth/me");
    if (!sessionState.authenticated) return;
    csrfToken = sessionState.csrfToken;
    showDashboard();
    await loadDashboard();
  } catch (error) {
    showLogin("Could not connect to the organizer service. Start the server and reload this page.");
    console.error(error);
  }
})();
