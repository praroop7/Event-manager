"""Behavior tests for the local event recommendation service."""

from datetime import date, timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import ai_recommender
from ai_recommender import draft_event_copy, recommend_events, tokenize


def event(event_id: str, name: str, category: str, description: str, event_date: str, seats: int = 10) -> dict[str, object]:
    return {
        "id": event_id,
        "name": name,
        "category": category,
        "description": description,
        "date": event_date,
        "venue": "Campus Hall",
        "seats": seats,
    }


class RecommendationTests(unittest.TestCase):
    def test_recommends_content_related_future_event(self) -> None:
        future_date = (date.today() + timedelta(days=10)).isoformat()
        events = [
            event("robotics", "Robotics Build Workshop", "Technology", "Build an AI-powered robot", future_date),
            event("music", "Acoustic Music Evening", "Culture", "Live music performances", future_date),
        ]

        result = recommend_events("I like robotics and artificial intelligence", events)

        self.assertTrue(result)
        self.assertEqual(result[0]["event"]["id"], "robotics")
        self.assertIn("reason", result[0])

    def test_omits_past_sold_out_and_unrelated_events(self) -> None:
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        events = [
            event("past", "Robotics Seminar", "Technology", "Robotics", yesterday),
            event("sold-out", "Robotics Challenge", "Technology", "Robotics", tomorrow, seats=0),
            event("unrelated", "Campus Garden Cleanup", "Community", "Volunteer together", tomorrow),
        ]

        result = recommend_events("robotics AI engineering", events)

        self.assertEqual(result, [])

    def test_returns_no_results_for_empty_interests(self) -> None:
        self.assertEqual(recommend_events("  ", [event("x", "Coding Workshop", "Technology", "Learn code", "2099-01-01")]), [])

    def test_minimum_text_match_score_filters_weaker_results(self) -> None:
        future_date = (date.today() + timedelta(days=10)).isoformat()
        events = [
            event("robotics", "Robotics Workshop", "Technology", "Build robots", future_date),
            event("music", "Music Evening", "Culture", "Live music", future_date),
        ]

        unfiltered = recommend_events("robotics", events)
        filtered = recommend_events("robotics", events, min_score=unfiltered[0]["score"] + 1)

        self.assertTrue(unfiltered)
        self.assertEqual(filtered, [])

    def test_synonym_explanation_does_not_claim_inferred_terms_were_in_event_details(self) -> None:
        future_date = (date.today() + timedelta(days=10)).isoformat()
        result = recommend_events(
            "AI",
            [event("robotics", "Robotics Workshop", "Technology", "Build robots", future_date)],
        )

        self.assertTrue(result)
        self.assertEqual(result[0]["reason"], "Related through the local campus-topic synonym map")

    def test_rejects_invalid_minimum_text_match_score(self) -> None:
        with self.assertRaises(ValueError):
            recommend_events("robotics", [], min_score=101)

    def test_filters_by_date_range_and_time_mentioned_in_description(self) -> None:
        event_date = (date.today() + timedelta(days=10)).isoformat()
        events = [
            event("morning", "Robotics Morning Workshop", "Technology", "Robotics starts at 10:30 AM", event_date),
            event("evening", "Robotics Evening Workshop", "Technology", "Robotics starts at 6:30 PM", event_date),
            event("unscheduled", "Robotics Workshop", "Technology", "Robotics workshop, time to be announced", event_date),
        ]

        morning = recommend_events(
            "robotics",
            events,
            date_from=event_date,
            date_to=event_date,
            time_of_day="morning",
        )
        evening = recommend_events("robotics", events, time_of_day="evening")

        self.assertEqual([item["event"]["id"] for item in morning], ["morning"])
        self.assertEqual({item["event"]["id"] for item in evening}, {"evening"})

    def test_rejects_invalid_date_range(self) -> None:
        with self.assertRaises(ValueError):
            recommend_events("robotics", [], date_from="2026-10-25", date_to="2026-10-20")

    def test_tokenizer_expands_known_campus_topics(self) -> None:
        terms = tokenize("AI workshop")
        self.assertIn("robotics", terms)
        self.assertIn("learning", terms)

    def test_ai_robotics_sample_events_match_at_least_40_percent(self) -> None:
        root = Path(__file__).parent
        baseline_events = json.loads((root / "sample-events.json").read_text(encoding="utf-8"))
        october_events = json.loads((root / "additional-sample-events.json").read_text(encoding="utf-8"))
        ai_robotics_events = json.loads((root / "ai-robotics-sample-events.json").read_text(encoding="utf-8"))
        future_date = (date.today() + timedelta(days=10)).isoformat()
        events = [
            {**item, "date": future_date}
            for item in baseline_events + october_events + ai_robotics_events
        ]

        with patch.object(ai_recommender, "MAX_RESULTS", 500):
            results = recommend_events("AI robotics", events, min_score=40, limit=500)

        matched_new_events = [
            item for item in results
            if item["event"]["id"].startswith("ai-robotics-sample-")
        ]
        self.assertEqual(len(matched_new_events), 20)
        self.assertTrue(all(item["score"] >= 40 for item in matched_new_events))


class EventCopyTests(unittest.TestCase):
    def test_drafts_category_aware_description_and_review_checklist(self) -> None:
        draft = draft_event_copy(
            "Robotics design workshop",
            "",
            "Teams build a small robot and present their prototype.",
            "first-year engineering students",
        )

        self.assertEqual(draft["suggestedCategory"], "Technology")
        self.assertIn("first-year engineering students", draft["description"])
        self.assertIn("present their prototype.", draft["description"])
        self.assertTrue(draft["checklist"])
        self.assertIn("review", draft["notice"].lower())

    def test_falls_back_to_general_category_without_claiming_event_logistics(self) -> None:
        draft = draft_event_copy("Student Gathering", "", "", "")

        self.assertEqual(draft["suggestedCategory"], "")
        self.assertEqual(draft["categoryConfidence"], 0.0)
        self.assertIn("schedule", draft["description"])
        self.assertNotIn("specific time", draft["description"].lower())


if __name__ == "__main__":
    unittest.main()
