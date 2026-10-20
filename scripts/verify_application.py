from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

SERVICE_TOKEN = os.getenv("SERVICE_API_TOKEN", "")
KNOWLEDGE_URL = os.getenv("KNOWLEDGE_BRAIN_URL", "http://127.0.0.1:8001").rstrip("/")
MEETING_URL = os.getenv("MEETING_AGENT_URL", "http://127.0.0.1:8002").rstrip("/")
INBOX_URL = os.getenv("INBOX_AGENT_URL", "http://127.0.0.1:3001").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:8080").rstrip("/")
REQUEST_TIMEOUT = max(60, int(float(os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "180")) + 60))
CHECKS = [
    ("Knowledge Brain", f"{KNOWLEDGE_URL}/health"),
    ("Meeting Agent", f"{MEETING_URL}/health"),
    ("Inbox Agent", f"{INBOX_URL}/health"),
    ("Frontend", f"{FRONTEND_URL}/"),
]


def request(url: str, payload: dict | None = None) -> tuple[int, dict | str]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if SERVICE_TOKEN:
        headers["Authorization"] = f"Bearer {SERVICE_TOKEN}"
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
        raw = response.read()
        content_type = response.headers.get("Content-Type", "")
        if "json" in content_type:
            return response.status, json.loads(raw.decode("utf-8"))
        return response.status, raw.decode("utf-8", errors="replace")


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


def main() -> int:
    started = time.monotonic()
    try:
        health: dict[str, dict] = {}
        for label, url in CHECKS:
            status, result = request(url)
            check(status == 200, f"{label} responds with HTTP 200")
            if isinstance(result, dict):
                health[label] = result
        if SERVICE_TOKEN:
            try:
                request(f"{KNOWLEDGE_URL}/openapi.json")
            except urllib.error.HTTPError as exc:
                check(exc.code == 404, "Protected deployment keeps public API documentation disabled")
            else:
                raise AssertionError("Protected deployment unexpectedly exposes the Knowledge Brain API schema")
        else:
            _, docs = request(f"{KNOWLEDGE_URL}/openapi.json")
            check(isinstance(docs, dict) and "/chat" in docs.get("paths", {}), "Knowledge Brain API schema is available")

        _, answer = request(
            f"{KNOWLEDGE_URL}/chat",
            {"question": "How are subscriptions canceled and refunds reviewed?"},
        )
        check(bool(answer.get("answer")) and isinstance(answer.get("sources"), list), "Knowledge Brain returns an answer and source list")

        _, samples = request(f"{INBOX_URL}/sample-emails")
        check(samples.get("count", 0) >= 50, "Inbox provides at least 50 customer email examples")
        sample_types = {item.get("emailType") for item in samples.get("emails", [])}
        check({"billing", "design", "search", "member", "integration", "proposal"}.issubset(sample_types), "Inbox examples cover the required customer request types")
        _, draft = request(
            f"{INBOX_URL}/draft-reply",
            {"emailText": "Can you update the homepage layout and explain if it requires custom development?"},
        )
        check(bool(draft.get("draftReply")) and bool(draft.get("source")), "Inbox drafts a reply with Knowledge Brain evidence")
        check(draft.get("requiresHumanReview") is True, "Inbox keeps a human review gate")

        _, scope_result = request(
            f"{MEETING_URL}/analyze",
            {"transcript": "Client needs search filters and a clearer homepage layout. Ask about acceptance criteria before estimating."},
        )
        scope = scope_result.get("scope", {})
        check(bool(scope_result.get("project_id")) and bool(scope.get("requirements")), "Meeting service returns a saved, structured scope")
        check(scope_result.get("approval_required") is True, "Proposal requires internal approval")
        check(bool(scope.get("estimate", {}).get("total_hours")), "Meeting scope includes estimate ranges")
        _, revision = request(
            f"{MEETING_URL}/compare",
            {
                "previous_transcript": "The client wants a cleaner homepage layout.",
                "current_transcript": "The client wants a cleaner homepage layout and a CRM integration for new leads.",
                "previous_scope": scope,
                "project_id": scope_result["project_id"],
            },
        )
        check(bool(revision.get("change_report", {}).get("new_items_to_quote")), "Meeting comparison flags newly added work for a separate quote")
        _, approval = request(
            f"{MEETING_URL}/engagements/{scope_result['project_id']}/approve",
            {"reviewer": "Verification script", "approved": False, "notes": "Automated smoke-test rejection; not client-reviewed."},
        )
        check(approval.get("approval_status") == "rejected" and approval.get("client_delivery_enabled") is False, "Meeting workflow records a human approval gate without client delivery")
        print(f"\nAll smoke checks passed in {time.monotonic() - started:.1f}s.")
        print("Model configured:", any(item.get("ai_model_configured") or item.get("aiModelConfigured") for item in health.values()))
        print("Crawl state:", health.get("Knowledge Brain", {}).get("crawler", {}).get("status"))
        return 0
    except (AssertionError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError) as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
