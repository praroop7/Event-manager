"""Local, explainable content-based event recommendations for the event manager."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
import re
from typing import Any

HOST = os.environ.get("AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("AI_PORT", "8000"))
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_EVENTS = 500
MAX_RESULTS = 5
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
TIME_PATTERN = re.compile(
    r"\b(?P<hour>1[0-2]|0?[1-9])(?::(?P<minute>[0-5][0-9]))?\s*(?P<period>a\.?m\.?|p\.?m\.?)\b"
    r"|\b(?P<military>(?:[01]?[0-9]|2[0-3]):[0-5][0-9])\b",
    re.IGNORECASE,
)
STOP_WORDS = {
    "a", "an", "and", "are", "at", "be", "by", "for", "from", "in", "is",
    "it", "of", "on", "or", "the", "to", "with", "event", "campus", "college",
    "sample", "demo", "showcase",
}
SYNONYMS = {
    "ai": {"artificial", "intelligence", "machine", "learning", "robotics"},
    "art": {"arts", "creative", "design", "photography", "culture"},
    "career": {"careers", "professional", "interview", "job", "resume"},
    "coding": {"code", "programming", "software", "technology", "hackathon"},
    "community": {"volunteering", "volunteer", "service", "social", "impact"},
    "dance": {"music", "performance", "culture", "festival"},
    "entrepreneurship": {"startup", "business", "founder", "pitch", "innovation"},
    "environment": {"sustainability", "green", "energy", "climate"},
    "fitness": {"sports", "sport", "athletics", "wellness", "team"},
    "research": {"science", "academic", "data", "symposium", "conference"},
    "robot": {"robotics", "engineering", "ai", "technology"},
    "talk": {"speaker", "lecture", "forum", "workshop", "conference"},
}
CATEGORY_PROFILES: dict[str, dict[str, Any]] = {
    "Technology": {
        "keywords": {"ai", "robot", "robotics", "code", "coding", "software", "technology", "data", "engineering", "digital"},
        "focus": "exploration, practical problem-solving, and new ideas",
        "checklist": ["Confirm software, equipment, or device requirements.", "Include skill level and any setup instructions."],
    },
    "Workshop": {
        "keywords": {"workshop", "learn", "training", "practice", "hands-on", "session"},
        "focus": "guided learning, useful takeaways, and hands-on participation",
        "checklist": ["State what participants will learn or make.", "Mention materials, prerequisites, and session length."],
    },
    "Culture & Arts": {
        "keywords": {"art", "arts", "music", "dance", "culture", "creative", "photo", "photography", "performance", "film"},
        "focus": "creative expression, shared experiences, and campus community",
        "checklist": ["List performance, participation, or audience details.", "Confirm accessibility and any photography guidance."],
    },
    "Careers": {
        "keywords": {"career", "careers", "job", "resume", "interview", "professional", "employer", "network"},
        "focus": "career exploration, practical preparation, and meaningful conversations",
        "checklist": ["Name the intended audience and any preparation to bring.", "Confirm speaker or employer details before publishing."],
    },
    "Sports & Wellness": {
        "keywords": {"sports", "sport", "fitness", "wellness", "yoga", "run", "team", "athletics", "health"},
        "focus": "wellbeing, teamwork, and inclusive participation",
        "checklist": ["Specify activity level, equipment, and clothing guidance.", "Confirm accessibility, safety, and weather arrangements."],
    },
    "Community & Sustainability": {
        "keywords": {"community", "volunteer", "service", "sustainability", "green", "climate", "environment", "social"},
        "focus": "community connection, shared responsibility, and positive action",
        "checklist": ["Explain the activity and how to take part.", "Confirm location, transport, and any items to bring."],
    },
    "Research & Ideas": {
        "keywords": {"research", "science", "symposium", "conference", "talk", "lecture", "forum", "innovation", "startup", "business"},
        "focus": "new perspectives, thoughtful discussion, and knowledge-sharing",
        "checklist": ["Add presenter details and a concise agenda when confirmed.", "Clarify whether attendees can ask questions or present work."],
    },
}
DEFAULT_PROFILE = {
    "focus": "connection, discovery, and active participation",
    "checklist": ["Explain what attendees can expect to do.", "Add any preparation, accessibility, or arrival information."],
}


def base_terms(text: str) -> list[str]:
    """Return normalized literal terms without adding inferred synonyms."""
    return [word for word in TOKEN_PATTERN.findall(text.lower()) if word not in STOP_WORDS and len(word) > 1]


def tokenize(text: str) -> list[str]:
    """Normalize text to useful lowercase terms and add a small synonym expansion."""
    words = base_terms(text)
    expanded = set(words)
    for word in words:
        expanded.update(SYNONYMS.get(word, ()))
    return sorted(expanded)


def tfidf_vectors(documents: list[list[str]]) -> list[dict[str, float]]:
    """Build lightweight normalized TF-IDF vectors without external model downloads."""
    if not documents:
        return []
    document_frequency: Counter[str] = Counter()
    term_counts: list[Counter[str]] = []
    for terms in documents:
        counts = Counter(terms)
        term_counts.append(counts)
        document_frequency.update(counts.keys())

    vectors: list[dict[str, float]] = []
    for counts in term_counts:
        vector = {
            term: (1 + math.log(count)) * (math.log((1 + len(documents)) / (1 + document_frequency[term])) + 1)
            for term, count in counts.items()
        }
        magnitude = math.sqrt(sum(value * value for value in vector.values()))
        vectors.append({term: value / magnitude for term, value in vector.items()} if magnitude else {})
    return vectors


def event_matches_time_of_day(event: dict[str, Any], preference: str) -> bool:
    """Only match a time preference when the published event description states a time."""
    if preference == "any":
        return True
    description = str(event.get("description", ""))
    matched_periods: set[str] = set()
    for match in TIME_PATTERN.finditer(description):
        if match.group("military"):
            hour = int(match.group("military").split(":")[0])
        else:
            hour = int(match.group("hour")) % 12
            if match.group("period").lower().startswith("p"):
                hour += 12
        if 5 <= hour < 12:
            matched_periods.add("morning")
        elif 12 <= hour < 17:
            matched_periods.add("afternoon")
        else:
            matched_periods.add("evening")

    for period in ("morning", "afternoon", "evening"):
        if re.search(rf"\b{period}\b", description, re.IGNORECASE):
            matched_periods.add(period)
    return preference in matched_periods


def is_valid_filter_date(value: str) -> bool:
    """Validate an optional ISO calendar date without leaking parse errors to the handler."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat() == value
    except ValueError:
        return False


def recommend_events(
    interests: str,
    events: list[dict[str, Any]],
    limit: int = 10,
    min_score: int = 0,
    date_from: str = "",
    date_to: str = "",
    time_of_day: str = "any",
) -> list[dict[str, Any]]:
    """Rank upcoming, available events by transparent interest-to-event text similarity."""
    if type(min_score) is not int or not 0 <= min_score <= 100:
        raise ValueError("Minimum text-match score must be a whole number from 0 to 100.")
    if not isinstance(time_of_day, str) or time_of_day not in {"any", "morning", "afternoon", "evening"}:
        raise ValueError("Choose any time, morning, afternoon, or evening.")
    if (date_from and not is_valid_filter_date(date_from)) or (date_to and not is_valid_filter_date(date_to)):
        raise ValueError("Enter valid start and end dates.")
    if date_from and date_to and date_from > date_to:
        raise ValueError("The end date must be the same as or later than the start date.")
    today = datetime.now(timezone.utc).date().isoformat()
    candidates = [
        event for event in events
        if isinstance(event, dict)
        and isinstance(event.get("date"), str)
        and event["date"] >= today
        and (not date_from or event["date"] >= date_from)
        and (not date_to or event["date"] <= date_to)
        and isinstance(event.get("seats"), (int, float))
        and event["seats"] > 0
        and event_matches_time_of_day(event, time_of_day)
    ][:MAX_EVENTS]
    if not candidates:
        return []

    original_terms = set(base_terms(interests))
    query_terms = tokenize(interests)
    if not query_terms:
        return []

    event_documents = [
        tokenize(" ".join(str(event.get(field, "")) for field in ("name", "category", "description", "venue")))
        for event in candidates
    ]
    event_literal_terms = [
        set(base_terms(" ".join(str(event.get(field, "")) for field in ("name", "category", "description", "venue"))))
        for event in candidates
    ]
    vectors = tfidf_vectors([query_terms, *event_documents])
    query_vector = vectors[0]
    recommendations: list[dict[str, Any]] = []

    for event, event_vector, literal_terms in zip(candidates, vectors[1:], event_literal_terms):
        similarity = sum(weight * event_vector.get(term, 0.0) for term, weight in query_vector.items())
        if similarity <= 0:
            continue

        score = round(min(99, similarity * 100))
        if score < min_score:
            continue

        matching_terms = sorted(original_terms.intersection(literal_terms))
        if matching_terms:
            reason = "Event details mention " + ", ".join(matching_terms[:3])
        else:
            reason = "Related through the local campus-topic synonym map"
        recommendations.append({
            "event": event,
            "score": score,
            "reason": reason,
        })

    recommendations.sort(key=lambda item: (item["score"], item["event"].get("date", "")), reverse=True)
    return recommendations[: max(1, min(int(limit), MAX_RESULTS))]


def draft_event_copy(name: str, category: str, details: str, audience: str = "") -> dict[str, Any]:
    """Classify event topics and draft editable, fact-conscious copy and a checklist."""
    terms = set(tokenize(" ".join((name, category, details))))
    best_category = "Campus Event"
    best_matches: set[str] = set()
    for label, profile in CATEGORY_PROFILES.items():
        matches = terms.intersection(profile["keywords"])
        if len(matches) > len(best_matches):
            best_category = label
            best_matches = matches

    profile = CATEGORY_PROFILES.get(best_category, DEFAULT_PROFILE)
    attendee = audience.strip() or "students and members of the campus community"
    event_title = name.strip()
    focus = profile["focus"]
    user_details = details.strip()
    if user_details:
        fact_sentence = user_details.rstrip(".!? ") + "."
        description = (
            f"Join us for {event_title}, a campus event for {attendee}. "
            f"{fact_sentence} "
            f"The session is designed around {focus}; check the event details for the confirmed schedule and participation information."
        )
    else:
        description = (
            f"Join us for {event_title}, a campus event for {attendee}. "
            f"Explore {focus} in a welcoming setting, connect with other participants, and take part at a level that suits you. "
            "Please check the final event details for the confirmed schedule, requirements, and accessibility information."
        )

    confidence = round(len(best_matches) / len(CATEGORY_PROFILES[best_category]["keywords"]), 2) if best_matches else 0.0
    return {
        "description": description,
        "suggestedCategory": best_category if best_category != "Campus Event" else "",
        "categoryConfidence": confidence,
        "matchedTopics": sorted(best_matches),
        "checklist": profile["checklist"],
        "notice": "AI-generated draft: review for accuracy and replace any generic wording before publishing.",
    }


class RecommendationHandler(BaseHTTPRequestHandler):
    server_version = "EventRecommendations/1.0"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = b"" if status == 204 else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin", "")
        if origin in {"null", "http://localhost:3000", "http://127.0.0.1:3000"}:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        origin = self.headers.get("Origin", "")
        if origin not in {"null", "http://localhost:3000", "http://127.0.0.1:3000"}:
            self._send_json(403, {"error": "This origin is not allowed."})
            return
        self._send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "feature": "content-based event recommendations"})
            return
        self._send_json(404, {"error": "Route not found."})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path not in {"/recommend", "/draft-event"}:
            self._send_json(404, {"error": "Route not found."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Invalid request length."})
            return
        if content_length < 1 or content_length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "Request must contain up to 2 MB of JSON."})
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {"error": "Request body must be a JSON object."})
            return

        if self.path == "/draft-event":
            name = payload.get("name", "")
            category = payload.get("category", "")
            details = payload.get("details", "")
            audience = payload.get("audience", "")
            if not isinstance(name, str) or not name.strip() or len(name) > 200:
                self._send_json(400, {"error": "Enter an event name of up to 200 characters."})
                return
            if not isinstance(category, str) or len(category) > 80:
                self._send_json(400, {"error": "Category must be 80 characters or fewer."})
                return
            if not isinstance(details, str) or len(details) > 1000:
                self._send_json(400, {"error": "Event details must be 1,000 characters or fewer."})
                return
            if not isinstance(audience, str) or len(audience) > 120:
                self._send_json(400, {"error": "Audience must be 120 characters or fewer."})
                return
            self._send_json(200, draft_event_copy(name, category, details, audience))
            return

        interests = payload.get("interests", "")
        events = payload.get("events", [])
        if not isinstance(interests, str) or len(interests) > 300:
            self._send_json(400, {"error": "Interests must be text of 300 characters or fewer."})
            return
        if not isinstance(events, list) or len(events) > MAX_EVENTS:
            self._send_json(400, {"error": f"Events must be a list of up to {MAX_EVENTS} items."})
            return
        if not interests.strip():
            self._send_json(400, {"error": "Enter a few topics you are interested in."})
            return

        min_score = payload.get("minScore", 0)
        if type(min_score) is not int or not 0 <= min_score <= 100:
            self._send_json(400, {"error": "Minimum text-match score must be a whole number from 0 to 100."})
            return

        date_from = payload.get("dateFrom", "")
        date_to = payload.get("dateTo", "")
        for field, value in (("start", date_from), ("end", date_to)):
            if not isinstance(value, str) or (value and not is_valid_filter_date(value)):
                self._send_json(400, {"error": f"Enter a valid {field} date."})
                return
        if date_from and date_to and date_from > date_to:
            self._send_json(400, {"error": "The end date must be the same as or later than the start date."})
            return
        time_of_day = payload.get("timeOfDay", "any")
        if not isinstance(time_of_day, str) or time_of_day not in {"any", "morning", "afternoon", "evening"}:
            self._send_json(400, {"error": "Choose any time, morning, afternoon, or evening."})
            return

        results = recommend_events(
            interests,
            events,
            min_score=min_score,
            date_from=date_from,
            date_to=date_to,
            time_of_day=time_of_day,
        )
        self._send_json(200, {
            "recommendations": results,
            "method": "TF-IDF text similarity with a transparent campus-topic synonym map",
            "message": "Scores describe text similarity, not predicted enjoyment or recommendation accuracy. No personal profile is stored.",
        })

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), RecommendationHandler)
    print(f"Local event recommendation service listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping recommendation service.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
