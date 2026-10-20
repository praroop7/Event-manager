const eventsList = document.getElementById("eventsList");
const eventView = document.body.dataset.eventView || "all";
const statusMessage = document.getElementById("pageSummary") || createStatusMessage();
const recommendationForm = document.getElementById("recommendationForm");
const recommendationResults = document.getElementById("recommendationResults");
const recommendationThreshold = document.getElementById("recommendationThreshold");
const recommendationThresholdValue = document.getElementById("recommendationThresholdValue");
const recommendationDateFrom = document.getElementById("recommendationDateFrom");
const recommendationDateTo = document.getElementById("recommendationDateTo");
const recommendationTime = document.getElementById("recommendationTime");
const recommendationPanel = recommendationForm?.closest(".ai-discovery");
let robotThanksTimer;
if (recommendationDateFrom) recommendationDateFrom.min = localDateString();
if (recommendationDateTo) recommendationDateTo.min = localDateString();
let events = [];
let usingLocalStorage = window.location.protocol === "file:";
let hasLoadedEvents = false;
let eventLoadFailed = false;
let isLoadingEvents = false;
let lastRecommendationInterests = "";
let recommendationFilterTimer;
const DEMO_EVENTS = [
  { id: "sample-past-roorkee-tech", name: "Demo: Robotics & AI Showcase — IIT Roorkee", date: "2026-09-18", venue: "Innovation Hall", category: "Technology", description: "Sample listing only; replace with verified event details. Not an official event record.", seats: 0, registered: 0 },
  { id: "sample-past-ropar-energy", name: "Demo: Sustainable Energy Workshop — IIT Ropar", date: "2026-08-22", venue: "Engineering Block, Room 204", category: "Workshop", description: "Sample listing only; replace with verified event details. Not an official event record.", seats: 0, registered: 0 },
  { id: "sample-past-bits-startup", name: "Demo: Student Startup Showcase — BITS Pilani", date: "2026-07-30", venue: "Innovation Auditorium", category: "Entrepreneurship", description: "Sample listing only; replace with verified event details. Not an official event record.", seats: 0, registered: 0 },
  { id: "sample-past-roorkee-forum", name: "Demo: Campus Innovation Forum — IIT Roorkee", date: "2026-06-14", venue: "Main Lecture Theatre", category: "Talk", description: "Sample listing only; replace with verified event details. Not an official event record.", seats: 0, registered: 0 },
  { id: "sample-past-bits-design", name: "Demo: Creative Designathon — BITS Pilani", date: "2026-05-09", venue: "Design Studio", category: "Competition", description: "Sample listing only; replace with verified event details. Not an official event record.", seats: 0, registered: 0 },
  { id: "sample-past-ropar-data", name: "Demo: Data Science Symposium — IIT Ropar", date: "2026-03-21", venue: "Academic Centre", category: "Conference", description: "Sample listing only; replace with verified event details. Not an official event record.", seats: 0, registered: 0 },
  { id: "sample-past-debate", name: "Inter-College Debate Championship (Sample)", date: "2025-12-06", venue: "Central Auditorium", category: "Debate", description: "A sample archive entry for demonstrating past-event listings.", seats: 0, registered: 0 },
  { id: "sample-past-culture", name: "Campus Cultural Evening (Sample)", date: "2025-11-15", venue: "Open-Air Theatre", category: "Culture", description: "A sample archive entry for demonstrating past-event listings.", seats: 0, registered: 0 },
  { id: "sample-past-green", name: "Green Campus Volunteer Day (Sample)", date: "2025-10-04", venue: "Campus Gardens", category: "Volunteering", description: "A sample archive entry for demonstrating past-event listings.", seats: 0, registered: 0 },
  { id: "sample-past-research", name: "Student Research Poster Expo (Sample)", date: "2025-09-12", venue: "Science Centre", category: "Research", description: "A sample archive entry for demonstrating past-event listings.", seats: 0, registered: 0 },
  { id: "sample-future-open-mic", name: "Campus Open Mic Night (Sample)", date: "2026-10-24", venue: "Student Commons", category: "Culture", description: "Demo event: student music, poetry, and stand-up performances.", seats: 80, registered: 0 },
  { id: "sample-future-code-sprint", name: "24-Hour Campus Code Sprint (Sample)", date: "2026-10-31", venue: "Computing Lab", category: "Technology", description: "Demo event: teams build a prototype and present it to volunteer mentors.", seats: 60, registered: 0 },
  { id: "sample-future-founders", name: "Ideas to Startups Workshop (Sample)", date: "2026-11-07", venue: "Business School Hall", category: "Entrepreneurship", description: "Demo event: turn an early idea into a simple pitch and customer discovery plan.", seats: 45, registered: 0 },
  { id: "sample-future-sports", name: "Inter-Department Sports Day (Sample)", date: "2026-11-14", venue: "University Sports Ground", category: "Sports", description: "Demo event: a friendly day of relay races and team activities.", seats: 120, registered: 0 },
  { id: "sample-future-photo", name: "Golden Hour Photo Walk (Sample)", date: "2026-11-21", venue: "Main Campus Gate", category: "Arts", description: "Demo event: a guided campus photography walk for beginners and enthusiasts.", seats: 35, registered: 0 },
  { id: "sample-future-career", name: "Career Readiness Clinic (Sample)", date: "2026-11-28", venue: "Career Services Centre", category: "Careers", description: "Demo event: practice interviews and get feedback on resumes.", seats: 50, registered: 0 },
  { id: "sample-future-fest", name: "Winter Lights Cultural Fest (Sample)", date: "2026-12-05", venue: "Main Quadrangle", category: "Culture", description: "Demo event: student performances, club booths, and campus activities.", seats: 200, registered: 0 },
  { id: "sample-future-robotics", name: "Build-a-Bot Challenge (Sample)", date: "2026-12-12", venue: "Makerspace", category: "Competition", description: "Demo event: teams design and test a simple robot challenge entry.", seats: 40, registered: 0 },
  { id: "sample-future-research", name: "Undergraduate Research Showcase (Sample)", date: "2027-01-16", venue: "Science Centre", category: "Research", description: "Demo event: students present projects and meet peers from other disciplines.", seats: 75, registered: 0 },
  { id: "sample-future-volunteer", name: "Community Service Saturday (Sample)", date: "2027-02-06", venue: "Community Engagement Office", category: "Volunteering", description: "Demo event: explore local service opportunities and join a volunteer team.", seats: 55, registered: 0 }
];

function createStatusMessage() {
  const message = document.createElement("p");
  message.id = "pageSummary";
  message.className = "page-summary";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  eventsList.insertAdjacentElement("beforebegin", message);
  return message;
}

function makeElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value || "Date not set"
    : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" }).format(parsed);
}

function getLocalEvents() {
  try {
    const stored = JSON.parse(localStorage.getItem("events") || "[]");
    const validEvents = Array.isArray(stored) ? stored.filter((event) => event && typeof event === "object") : [];
    if (validEvents.length) return validEvents;
    localStorage.setItem("events", JSON.stringify(DEMO_EVENTS));
    return DEMO_EVENTS;
  } catch {
    return [];
  }
}

const searchInput = document.createElement("input");
searchInput.type = "search";
searchInput.placeholder = "Search events, venues, or categories";
searchInput.setAttribute("aria-label", "Search events, venues, or categories");

const filterSelect = document.createElement("select");
filterSelect.setAttribute("aria-label", "Filter events");
[["all", "All events"], ["available", "Seats available"], ["full", "Fully booked"]].forEach(([value, label]) => {
  const option = makeElement("option", "", label);
  option.value = value;
  filterSelect.appendChild(option);
});

const sortSelect = document.createElement("select");
sortSelect.setAttribute("aria-label", "Sort events");
[["date", "Sort by date"], ["name", "Sort by name"], ["seats", "Sort by seats"]].forEach(([value, label]) => {
  const option = makeElement("option", "", label);
  option.value = value;
  sortSelect.appendChild(option);
});

const controls = makeElement("div", "event-controls");
controls.append(searchInput, filterSelect, sortSelect);
eventsList.insertAdjacentElement("beforebegin", controls);

function showMessage(message, state = "") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-loading", state === "loading");
  statusMessage.classList.toggle("message-error", state === "error");
}

function renderRecommendations(recommendations) {
  if (!recommendationResults) return;
  recommendationResults.replaceChildren();
  if (!recommendations.length) {
    recommendationResults.appendChild(makeElement("p", "empty", "No close matches yet. Try another interest, such as technology, arts, careers, or sports."));
    return;
  }

  recommendations.forEach(({ event, score, reason }) => {
    const card = makeElement("article", "recommendation-card");
    const header = makeElement("div", "recommendation-heading");
    header.append(
      makeElement("span", "recommendation-match", `${score}% text match`),
      makeElement("span", "event-category", event.category || "Campus event")
    );
    card.append(
      header,
      makeElement("h3", "", event.name),
      makeElement("p", "recommendation-reason", reason),
      makeElement("p", "recommendation-meta", `📅 ${formatDate(event.date)} · 📍 ${event.venue} · 🎟️ ${event.seats} seats`)
    );
    card.appendChild(createRegistrationLink(event, "recommendation-register", "Register for this event"));
    recommendationResults.appendChild(card);
  });
}

function createRegistrationLink(event, className, label) {
  const link = makeElement("a", className, label);
  link.href = `registration.html?eventId=${encodeURIComponent(event.id)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Register for ${event.name} (opens in a new tab)`);
  return link;
}

if (recommendationForm && recommendationResults) {
  const recommendationMessage = document.getElementById("recommendationMessage");
  const robotSpeakButton = document.getElementById("robotSpeakButton");
  const speechSynthesis = window.speechSynthesis;
  let robotSpeechText = "Hi, how can I help you?";
  let currentUtterance;

  if (!speechSynthesis || !window.SpeechSynthesisUtterance) {
    robotSpeakButton.disabled = true;
    robotSpeakButton.title = "Speech playback is not supported by this browser.";
    robotSpeakButton.textContent = "🔊 Speech unavailable";
  } else {
    robotSpeakButton.addEventListener("click", () => {
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        currentUtterance = undefined;
        speechSynthesis.cancel();
        robotSpeakButton.textContent = "🔊 Hear robot";
        robotSpeakButton.setAttribute("aria-pressed", "false");
        return;
      }

      const utterance = new window.SpeechSynthesisUtterance(robotSpeechText);
      utterance.lang = navigator.language || "en-US";
      utterance.rate = 0.95;
      utterance.pitch = 1.1;
      currentUtterance = utterance;
      robotSpeakButton.textContent = "⏹ Stop robot";
      robotSpeakButton.setAttribute("aria-pressed", "true");
      utterance.addEventListener("end", () => {
        if (currentUtterance !== utterance) return;
        robotSpeakButton.textContent = "🔊 Hear robot";
        robotSpeakButton.setAttribute("aria-pressed", "false");
        currentUtterance = undefined;
      });
      utterance.addEventListener("error", () => {
        if (currentUtterance !== utterance) return;
        robotSpeakButton.textContent = "🔊 Hear robot";
        robotSpeakButton.setAttribute("aria-pressed", "false");
        currentUtterance = undefined;
        recommendationMessage.textContent = "The browser could not play the robot's voice. Please try again.";
      });
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
  }

  async function findRecommendedEvents(interests) {
    const button = recommendationForm.querySelector("button[type='submit']");
    const message = recommendationMessage;
    const threshold = Number(recommendationThreshold.value);
    const dateFrom = recommendationDateFrom.value;
    const dateTo = recommendationDateTo.value;
    if (!interests) {
      message.textContent = "Add one or more interests to get recommendations.";
      return false;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      message.textContent = "The end date must be the same as or later than the start date.";
      recommendationDateTo.focus();
      return false;
    }
    button.disabled = true;
    clearTimeout(robotThanksTimer);
    recommendationPanel.classList.remove("ai-robot-thanks", "ai-robot-found", "ai-robot-no-results");
    recommendationPanel.classList.add("ai-searching");
    recommendationForm.classList.add("ai-searching");
    message.textContent = "Comparing your interests with upcoming event details…";
    recommendationResults.replaceChildren();
    try {
      const directFileMode = window.location.protocol === "file:";
      const recommendationUrl = directFileMode
        ? "http://127.0.0.1:8000/recommend"
        : "/api/recommendations";
      const upcomingEvents = events.filter((event) => event.date >= localDateString());
      const response = await fetch(recommendationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interests,
          minScore: threshold,
          dateFrom,
          dateTo,
          timeOfDay: recommendationTime.value,
          events: upcomingEvents
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create recommendations.");
      const recommendations = result.recommendations || [];
      renderRecommendations(recommendations);
      message.textContent = recommendations.length
        ? `${recommendations.length} suggestion${recommendations.length === 1 ? "" : "s"} meet${recommendations.length === 1 ? "s" : ""} the ${threshold}% minimum · ${result.message}`
        : `No matches meet the ${threshold}% minimum. Try lowering the filter or changing your interests.`;
      robotSpeechText = recommendations.length
        ? `I found ${recommendations.length} event suggestion${recommendations.length === 1 ? "" : "s"} for ${interests}. ${recommendations.slice(0, 3).map(({ event }) => event.name).join(". ")}.`
        : "I couldn't find a close match this time. Try lowering the text-match filter or changing your interests.";
      recommendationPanel.classList.remove("ai-searching");
      recommendationPanel.classList.add(recommendations.length ? "ai-robot-found" : "ai-robot-no-results");
      robotThanksTimer = setTimeout(() => {
        recommendationPanel.classList.remove("ai-robot-found", "ai-robot-no-results");
        recommendationPanel.classList.add("ai-robot-thanks");
        robotThanksTimer = setTimeout(() => recommendationPanel.classList.remove("ai-robot-thanks"), 2200);
      }, 1500);
      return true;
    } catch (error) {
      recommendationPanel.classList.remove("ai-searching", "ai-robot-thanks", "ai-robot-found");
      recommendationPanel.classList.add("ai-robot-no-results");
      message.textContent = window.location.protocol === "file:"
        ? "The local Python AI service is not running. Start it with start-ai.bat, leave its window open, and try again."
        : error.message;
      robotSpeechText = message.textContent;
      robotThanksTimer = setTimeout(() => recommendationPanel.classList.remove("ai-robot-no-results"), 2400);
      return false;
    } finally {
      button.disabled = false;
      recommendationForm.classList.remove("ai-searching");
      recommendationPanel.classList.remove("ai-searching");
    }
  }

  recommendationForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    lastRecommendationInterests = document.getElementById("recommendationInterests").value.trim();
    await findRecommendedEvents(lastRecommendationInterests);
  });

  const voiceCommandButton = document.getElementById("voiceCommandButton");
  const voiceCommandHint = document.getElementById("voiceCommandHint");
  const voiceCommandMessage = document.getElementById("recommendationMessage");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceCommandButton.disabled = true;
    voiceCommandButton.title = "Voice input is not supported by this browser.";
    voiceCommandHint.textContent = "Voice input is not supported by this browser. You can still type your interests.";
  } else {
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    let isListening = false;

    voiceCommandButton.addEventListener("click", () => {
      if (isListening) {
        recognition.stop();
        return;
      }
      try {
        recognition.start();
      } catch (error) {
        console.error("Could not start voice input.", error);
        voiceCommandMessage.textContent = "Could not start voice input. Please try again or type your interests.";
      }
    });

    recognition.addEventListener("start", () => {
      isListening = true;
      voiceCommandButton.setAttribute("aria-pressed", "true");
      voiceCommandButton.textContent = "Listening…";
      recommendationPanel.classList.add("ai-listening");
      voiceCommandMessage.textContent = "Listening. Say something like “Find events about robotics.”";
    });

    recognition.addEventListener("result", async (event) => {
      const spokenCommand = event.results[0][0].transcript.trim();
      const interests = spokenCommand
        .replace(/^(?:hey\s+robot[, ]*)?(?:please\s+)?(?:find|show|recommend|search(?:\s+for)?|look\s+for)\s+(?:me\s+)?(?:some\s+)?(?:events?\s+)?(?:about|for|on|related\s+to)\s+/i, "")
        .trim();
      if (!interests) {
        voiceCommandMessage.textContent = "I didn’t catch any interests. Try again or type them in.";
        return;
      }
      document.getElementById("recommendationInterests").value = interests.slice(0, 300);
      lastRecommendationInterests = interests.slice(0, 300);
      await findRecommendedEvents(lastRecommendationInterests);
    });

    recognition.addEventListener("error", (event) => {
      const messages = {
        "not-allowed": "Microphone access was denied. Allow microphone access in your browser settings, or type your interests.",
        "service-not-allowed": "Voice input is blocked by the browser. You can still type your interests.",
        "no-speech": "I didn’t hear anything. Try speaking again.",
        "audio-capture": "No microphone was found. Connect a microphone or type your interests.",
        network: "Voice recognition could not connect. Check your connection and try again."
      };
      voiceCommandMessage.textContent = messages[event.error] || "Voice input failed. Please try again or type your interests.";
    });

    recognition.addEventListener("end", () => {
      isListening = false;
      voiceCommandButton.setAttribute("aria-pressed", "false");
      voiceCommandButton.textContent = "🎙️ Speak";
      recommendationPanel.classList.remove("ai-listening");
    });
  }

  recommendationThreshold.addEventListener("input", () => {
    recommendationThresholdValue.value = `${recommendationThreshold.value}%`;
    recommendationThresholdValue.textContent = `${recommendationThreshold.value}%`;
    if (!lastRecommendationInterests) return;
    clearTimeout(recommendationFilterTimer);
    recommendationFilterTimer = setTimeout(() => {
      findRecommendedEvents(lastRecommendationInterests);
    }, 250);
  });

  [recommendationDateFrom, recommendationDateTo, recommendationTime].forEach((control) => {
    control.addEventListener("change", () => {
      if (!lastRecommendationInterests) return;
      findRecommendedEvents(lastRecommendationInterests);
    });
  });
}

function visibleEvents() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const today = localDateString();
  return events.filter((event) => {
    const isPast = event.date < today;
    const inView = eventView === "past" ? isPast : eventView === "upcoming" ? !isPast : true;
    const text = `${event.name || ""} ${event.venue || ""} ${event.category || ""} ${event.description || ""}`.toLocaleLowerCase();
    const seats = Math.max(0, Number(event.seats) || 0);
    const matchesFilter = filterSelect.value === "all"
      || (filterSelect.value === "available" && seats > 0 && !isPast)
      || (filterSelect.value === "full" && seats <= 0 && !isPast);
    return inView && matchesFilter && text.includes(query);
  }).sort((first, second) => {
    if (sortSelect.value === "name") return String(first.name).localeCompare(String(second.name));
    if (sortSelect.value === "seats") return Number(second.seats || 0) - Number(first.seats || 0);
    const order = String(first.date).localeCompare(String(second.date));
    return eventView === "past" ? -order : order;
  });
}

function createEventCard(event) {
  const today = localDateString();
  const past = event.date < today;
  const seats = Math.max(0, Number(event.seats) || 0);
  const card = makeElement("article", `event${past ? " event-past" : ""}`);
  const heading = makeElement("div", "event-heading");
  const title = makeElement("div", "event-title-block");
  title.appendChild(makeElement("h3", "", event.name || "Untitled event"));
  if (event.category) title.appendChild(makeElement("span", "event-category", event.category));
  heading.append(title, makeElement("span", `event-badge ${past ? "badge-past" : seats > 0 ? "badge-open" : "badge-full"}`, past ? "Completed" : seats > 0 ? "Registration open" : "Fully booked"));
  card.appendChild(heading);

  const expandableDetails = document.createElement("details");
  expandableDetails.className = "event-more-details";
  const detailsSummary = makeElement("summary", "", "View event details");
  const details = makeElement("div", "event-details");
  if (event.description) details.appendChild(makeElement("p", "event-description", event.description));
  details.append(
    makeElement("p", "", `📅 ${formatDate(event.date)}`),
    makeElement("p", "", `📍 ${event.venue || "Venue not specified"}`),
    makeElement("p", "", `👥 ${Number(event.registered) || 0} registered`)
  );
  if (!past) details.appendChild(makeElement("p", "", `🎟️ ${seats} ${seats === 1 ? "seat" : "seats"} left`));
  expandableDetails.append(detailsSummary, details);
  card.appendChild(expandableDetails);

  if (!past) {
    if (seats > 0) {
      card.appendChild(createRegistrationLink(event, "event-register-link", "Register"));
    } else {
      const registerButton = makeElement("button", "event-register-link", "Fully booked");
      registerButton.type = "button";
      registerButton.disabled = true;
      card.appendChild(registerButton);
    }
  }
  return card;
}

function renderEvents() {
  eventsList.setAttribute("aria-busy", "false");
  const shown = visibleEvents();
  eventsList.replaceChildren();
  if (!shown.length) {
    const message = searchInput.value || filterSelect.value !== "all"
      ? "No events match these search and filter options."
      : eventView === "past"
        ? "No past events are available yet."
        : eventView === "upcoming"
          ? "No future events are available yet. Check back soon."
          : "No events are available yet. Visit the organizer page to publish an event.";
    eventsList.appendChild(makeElement("p", "empty", message));
  } else {
    shown.forEach((event) => eventsList.appendChild(createEventCard(event)));
  }

  const registrations = shown.reduce((sum, event) => sum + (Number(event.registered) || 0), 0);
  const label = eventView === "past" ? "past event" : eventView === "upcoming" ? "upcoming event" : "event";
  showMessage(`${shown.length} ${label}${shown.length === 1 ? "" : "s"} · ${registrations} registration${registrations === 1 ? "" : "s"}`);
}

async function loadEvents() {
  if (usingLocalStorage) {
    eventsList.setAttribute("aria-busy", "false");
    events = getLocalEvents();
    renderEvents();
    return;
  }

  if (isLoadingEvents) return;
  isLoadingEvents = true;
  if (!hasLoadedEvents) {
    eventsList.setAttribute("aria-busy", "true");
    showMessage("Loading events…", "loading");
  }

  try {
    const response = await fetch(`/api/events?view=${encodeURIComponent(eventView)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load events.");
    const nextEvents = Array.isArray(result.events) ? result.events : [];
    const changed = JSON.stringify(nextEvents) !== JSON.stringify(events);
    const shouldRender = !hasLoadedEvents || changed || eventLoadFailed;
    events = nextEvents;
    hasLoadedEvents = true;
    eventLoadFailed = false;
    localStorage.setItem("events", JSON.stringify(events));
    if (shouldRender) renderEvents();
  } catch (error) {
    console.error("Could not load events from the server.", error);
    eventLoadFailed = true;
    showMessage("Could not reach the server. Retrying automatically.", "error");
  } finally {
    isLoadingEvents = false;
  }
}

[searchInput, filterSelect, sortSelect].forEach((control) => {
  control.addEventListener("input", renderEvents);
  control.addEventListener("change", renderEvents);
});

window.addEventListener("focus", () => {
  if (!usingLocalStorage) void loadEvents();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !usingLocalStorage) void loadEvents();
});

window.setInterval(() => {
  if (!document.hidden && !usingLocalStorage) void loadEvents();
}, 30_000);

loadEvents();
