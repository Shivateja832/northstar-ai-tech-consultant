import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from services.knowledge_brain import crawler, main as knowledge, storage
from services.meeting_agent import main as meeting


class KnowledgeWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "knowledge.db"
        self.seed_path = Path(self.temp_dir.name) / "missing-seed.json"
        self.db_patch = patch.object(storage, "DB_PATH", self.db_path)
        self.seed_patch = patch.object(storage, "SEED_PATH", self.seed_path)
        self.db_patch.start()
        self.seed_patch.start()
        storage.initialize()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.seed_patch.stop()
        self.temp_dir.cleanup()

    def test_article_is_searchable_with_citation_fields(self) -> None:
        article = {
            "id": "test-billing",
            "url": "https://example.test/billing",
            "title": "Cancellation and renewal policy",
            "category": "Billing",
            "folder": "Subscriptions",
            "content": "Disable automatic renewal from the subscription settings. Refund eligibility requires human review.",
            "images": [{"url": "https://example.test/screenshot.png", "alt": "renewal setting"}],
            "tags": ["cancel", "refund"],
        }
        with storage.connect() as db:
            storage.store_article(db, article, source="test")
        result = storage.search_articles("How do I cancel the subscription?", limit=2)
        self.assertEqual(result[0]["url"], "https://example.test/billing")
        self.assertEqual(result[0]["title"], "Cancellation and renewal policy")

    def test_agent_retrieval_can_skip_slow_model_answer_generation(self) -> None:
        article = {
            "id": "source-1",
            "url": "https://example.test/source",
            "title": "Verified product guidance",
            "category": "Product",
            "folder": "",
            "content": "Use the built-in settings and ask a human to review billing decisions.",
            "images": [],
            "tags": [],
            "source": "test",
        }
        with patch.object(storage, "search_articles", return_value=[article]), patch.object(
            knowledge.ai_provider, "configured", return_value=True
        ), patch.object(knowledge.ai_provider, "generate_json") as generate:
            result = knowledge.chat(knowledge.ChatRequest(question="Test", generate_answer=False))
        self.assertEqual(result["mode"], "retrieval")
        self.assertEqual(result["sources"][0]["title"], "Verified product guidance")
        generate.assert_not_called()

    def test_changed_articles_update_and_removed_pages_are_excluded(self) -> None:
        article = {
            "id": "test-one",
            "url": "https://example.test/one",
            "title": "Search options",
            "category": "Product",
            "content": "Search supports category filters.",
            "images": [],
            "tags": [],
        }
        with storage.connect() as db:
            storage.store_article(db, article, source="sitemap")
            article["content"] = "Search supports category and location filters."
            self.assertTrue(storage.store_article(db, article, source="sitemap"))
            db.execute("UPDATE articles SET active=0 WHERE id='test-one'")
            db.execute("DELETE FROM article_search WHERE article_id='test-one'")
        self.assertEqual(storage.search_articles("location filters"), [])

    def test_sitemap_html_parser_keeps_article_and_image_context(self) -> None:
        html = b"""<html><head><title>Search setup</title></head><body><nav>Skip navigation</nav>
        <nav aria-label='breadcrumbs'><a>Home</a><a>Knowledge Base</a><a>Search Setup</a></nav>
        <main><h1>Configure directory search</h1><p>Open the search settings and enable category filters.
        Save your changes and verify results for each category.</p>
        <img src='/images/search-settings.png' alt='Category filter settings panel'></main></body></html>"""
        article = crawler._extract(
            "https://support.brilliantdirectories.com/support/solutions/search",
            html,
            "text/html",
        )
        self.assertIsNotNone(article)
        self.assertIn("Configure directory search", article["content"])
        self.assertEqual(article["images"][0]["alt"], "Category filter settings panel")
        self.assertNotIn("Skip navigation", article["content"])
        self.assertEqual(article["category"], "Knowledge Base")
        self.assertEqual(article["folder"], "")


class MeetingWorkflowTests(unittest.TestCase):
    def test_product_lookup_uses_retrieval_without_extra_model_generation(self) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"answer":"product evidence","sources":[]}'
        requirement = {"title": "Search", "description": "Add location filters."}
        with patch.object(meeting.urllib.request, "urlopen", return_value=response) as urlopen:
            meeting._knowledge_lookup(requirement)
        request = urlopen.call_args.args[0]
        self.assertFalse(json.loads(request.data)["generate_answer"])

    def test_transcripts_are_split_into_bounded_context_chunks(self) -> None:
        transcript = "\n\n".join(f"Speaker: {index} " + ("requirement " * 600) for index in range(8))
        chunks = meeting.transcript_chunks(transcript, max_chars=1800, overlap=150)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 1800 for chunk in chunks))

    def test_requirement_extraction_covers_more_than_demo_keywords(self) -> None:
        requirements = meeting.rule_extract_requirements(
            "We need accessible contrast for screen readers. The performance is slow on the dashboard and customers need analytics reports."
        )
        titles = {item["title"] for item in requirements}
        self.assertIn("Accessibility improvements", titles)
        self.assertIn("Performance and reliability", titles)
        self.assertIn("Reporting and analytics", titles)

    def test_scope_revision_marks_new_work_for_separate_quote(self) -> None:
        previous = {"requirements": [{"id": "design", "title": "Website design", "description": "Update the homepage layout."}]}
        current = {"requirements": [
            {"id": "design", "title": "Website design", "description": "Update the homepage layout."},
            {"id": "crm", "title": "CRM integration", "description": "Sync lead form data to CRM."},
        ]}
        changes = meeting.compare_scopes(previous, current)
        self.assertEqual(len(changes["added"]), 1)
        self.assertEqual(changes["new_items_to_quote"][0]["id"], "crm")

    def test_engagement_store_persists_multiple_revisions_for_one_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "meetings.db"
            with patch.object(meeting, "DB_PATH", database):
                scope = {"requirements": [], "proposal": {}}
                first = meeting.save_engagement("project-1", "first transcript", scope)
                second = meeting.save_engagement("project-1", "second transcript", scope)
                self.assertEqual(first["revision"], 1)
                self.assertEqual(second["revision"], 2)
                with meeting.connect() as db:
                    rows = db.execute("SELECT revision FROM engagements WHERE id=? ORDER BY revision", ("project-1",)).fetchall()
                self.assertEqual([row["revision"] for row in rows], [1, 2])

    def test_legacy_engagement_table_migrates_to_revision_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "meetings.db"
            with patch.object(meeting, "DB_PATH", database):
                with meeting.connect() as db:
                    db.execute(
                        """
                        CREATE TABLE engagements (
                            id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
                            transcript TEXT NOT NULL, scope_json TEXT NOT NULL,
                            proposal_json TEXT NOT NULL, approval_status TEXT NOT NULL DEFAULT 'pending',
                            reviewer TEXT, approval_notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                        )
                        """
                    )
                    db.execute(
                        "INSERT INTO engagements(id,revision,transcript,scope_json,proposal_json) VALUES(?,?,?,?,?)",
                        ("preserved-project", 1, "old", "{}", "{}"),
                    )
                meeting.initialize()
                with meeting.connect() as db:
                    row = db.execute("SELECT transcript FROM engagements WHERE id=?", ("preserved-project",)).fetchone()
                    pks = [item["name"] for item in sorted(db.execute("PRAGMA table_info(engagements)").fetchall(), key=lambda item: item["pk"]) if item["pk"]]
                self.assertEqual(row["transcript"], "old")
                self.assertEqual(pks, ["id", "revision"])


if __name__ == "__main__":
    unittest.main()
