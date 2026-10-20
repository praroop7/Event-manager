const registrationForm = document.getElementById("registrationForm");
const registrationStatus = document.getElementById("registrationStatus");
const registrationSubmit = document.getElementById("registrationSubmit");
const registrationSubmitStatus = document.getElementById("registrationSubmitStatus");
const registrationEvent = document.getElementById("registrationEvent");
const registrationSuccess = document.getElementById("registrationSuccess");
const eventId = new URLSearchParams(window.location.search).get("eventId");
let selectedEvent = null;

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.remove("is-loading");
  element.classList.toggle("message-error", isError);
  element.classList.toggle("message-success", Boolean(message) && !isError);
}

function formatEventDate(value) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value || "Date not set"
    : new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(parsed);
}

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function loadSelectedEvent() {
  if (!eventId) throw new Error("No event was selected. Return to Future Events and choose an event to register for.");

  if (window.location.protocol === "file:") {
    const storedEvents = JSON.parse(localStorage.getItem("events") || "[]");
    if (!Array.isArray(storedEvents)) throw new Error("The saved event list could not be read.");
    return storedEvents.find((event) => event && String(event.id) === eventId);
  }

  const response = await fetch("/api/events?view=all");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load the selected event.");
  const allEvents = Array.isArray(result.events) ? result.events : [];
  return allEvents.find((event) => String(event.id) === eventId);
}

async function initializeRegistration() {
  try {
    selectedEvent = await loadSelectedEvent();
    if (!selectedEvent) throw new Error("This event could not be found. It may have been removed.");
    if (selectedEvent.date < localDateString()) throw new Error("Registration for this event has closed.");
    if (Number(selectedEvent.seats) < 1) throw new Error("This event is fully booked.");

    document.getElementById("registrationEventName").textContent = selectedEvent.name;
    document.getElementById("registrationEventMeta").textContent =
      `${formatEventDate(selectedEvent.date)} · ${selectedEvent.venue || "Venue not specified"} · ${selectedEvent.seats} seats available`;
    registrationEvent.hidden = false;
    registrationStatus.hidden = true;
    registrationForm.hidden = false;
    document.getElementById("registrationName").focus();
  } catch (error) {
    setStatus(registrationStatus, error.message, true);
  }
}

function saveLocalRegistration(payload) {
  const storedEvents = JSON.parse(localStorage.getItem("events") || "[]");
  const registrations = JSON.parse(localStorage.getItem("registrations") || "[]");
  if (!Array.isArray(storedEvents) || !Array.isArray(registrations)) {
    throw new Error("The saved registration data could not be read.");
  }
  const event = storedEvents.find((item) => item && String(item.id) === eventId);
  if (!event || Number(event.seats) < 1) throw new Error("This event is fully booked.");
  const duplicate = registrations.some((registration) =>
    String(registration.eventId) === eventId
    && (String(registration.email || "").toLowerCase() === payload.email
      || String(registration.student || "").trim().toLowerCase() === payload.student.toLowerCase())
  );
  if (duplicate) throw new Error("This name or email is already registered for the event.");

  event.seats--;
  event.registered = (Number(event.registered) || 0) + 1;
  registrations.push({
    ...payload,
    event: event.name,
    eventId,
    registeredAt: new Date().toISOString()
  });
  localStorage.setItem("events", JSON.stringify(storedEvents));
  localStorage.setItem("registrations", JSON.stringify(registrations));
}

registrationForm.addEventListener("submit", async (submitEvent) => {
  submitEvent.preventDefault();
  registrationSubmitStatus.textContent = "Confirming your place…";
  registrationSubmitStatus.classList.remove("message-error", "message-success");
  registrationSubmitStatus.classList.add("is-loading");
  registrationForm.setAttribute("aria-busy", "true");
  registrationSubmit.disabled = true;

  const formData = new FormData(registrationForm);
  const payload = {
    student: String(formData.get("student") || "").trim(),
    collegeName: String(formData.get("collegeName") || "").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    phone: String(formData.get("phone") || "").trim(),
    studentId: String(formData.get("studentId") || "").trim(),
    courseDepartment: String(formData.get("courseDepartment") || "").trim(),
    yearOfStudy: String(formData.get("yearOfStudy") || "").trim(),
    privacyAcknowledged: formData.get("privacyAcknowledged") === "on"
  };

  try {
    if (!payload.privacyAcknowledged) {
      throw new Error("Acknowledge how your registration details will be used before continuing.");
    }
    if (window.location.protocol === "file:") {
      saveLocalRegistration(payload);
    } else {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Registration could not be completed.");
    }

    registrationForm.hidden = true;
    registrationSuccess.hidden = false;
    registrationStatus.hidden = true;
    document.getElementById("registrationSuccessMessage").textContent =
      `Your place at ${selectedEvent.name} is confirmed.`;
  } catch (error) {
    setStatus(registrationSubmitStatus, error.message, true);
  } finally {
    registrationSubmitStatus.classList.remove("is-loading");
    registrationForm.setAttribute("aria-busy", "false");
    registrationSubmit.disabled = false;
  }
});

initializeRegistration();
