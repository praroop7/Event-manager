const feedbackForm = document.getElementById("feedbackForm");
const feedbackEvent = document.getElementById("feedbackEvent");
const feedbackStatus = document.getElementById("feedbackStatus");
const feedbackSubmit = document.getElementById("feedbackSubmit");

async function loadFeedbackEvents() {
  try {
    const response = await fetch("/api/events?view=all");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load the event list.");

    (Array.isArray(result.events) ? result.events : []).forEach((event) => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = `${event.name} — ${event.date}`;
      feedbackEvent.appendChild(option);
    });
  } catch (error) {
    console.error("Could not load feedback event options.", error);
    feedbackStatus.textContent = "The event list could not be loaded. You can still send general feedback.";
    feedbackStatus.classList.add("message-error");
  }
}

feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  feedbackStatus.textContent = "Sending your feedback…";
  feedbackStatus.classList.remove("message-error", "message-success", "feedback-success");
  feedbackStatus.classList.add("is-loading");
  feedbackSubmit.disabled = true;

  const formData = new FormData(feedbackForm);
  const payload = {
    eventId: formData.get("eventId"),
    rating: Number(formData.get("rating")),
    message: String(formData.get("message") || "").trim()
  };

  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Your feedback could not be sent.");

    feedbackForm.reset();
    feedbackStatus.textContent = "Thank you! Your feedback has been received.";
    feedbackStatus.classList.add("feedback-success");
    feedbackStatus.classList.add("message-success");
  } catch (error) {
    feedbackStatus.classList.remove("feedback-success");
    feedbackStatus.textContent = error.message;
    feedbackStatus.classList.add("message-error");
  } finally {
    feedbackStatus.classList.remove("is-loading");
    feedbackSubmit.disabled = false;
  }
});

loadFeedbackEvents();
