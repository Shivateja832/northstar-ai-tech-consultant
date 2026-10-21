from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from typing import Any

from . import ai_provider, storage

DEFAULT_SITEMAP = os.getenv(
    "HELP_CENTER_SITEMAP_URL",
    "https://support.brilliantdirectories.com/support/sitemap.xml",
)
USER_AGENT = "AITechConsultantKnowledgeBot/1.0 (+polite help-center indexing)"
_worker_lock = threading.Lock()


class ArticleParser(HTMLParser):
    def __init__(self, page_url: str):
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.images: list[dict[str, str]] = []
        self.headings: list[str] = []
        self.breadcrumb_parts: list[str] = []
        self._stack: list[str] = []
        self._ignored = 0
        self._in_title = False
        self._in_heading = False
        self._breadcrumb_depth = 0
        self._breadcrumb_tags: list[str] = []
        self._current_heading: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        breadcrumb_marker = (
            "breadcrumb" in (attr.get("class") or "").lower()
            or "breadcrumb" in (attr.get("aria-label") or "").lower()
        )
        if breadcrumb_marker:
            self._breadcrumb_depth += 1
            self._breadcrumb_tags.append(tag)
        if tag in {"script", "style", "nav", "footer", "header", "noscript", "svg"} and not self._breadcrumb_depth:
            self._ignored += 1
            self._stack.append(tag)
            return
        self._stack.append(tag)
        if tag == "title":
            self._in_title = True
        if tag in {"h1", "h2", "h3"}:
            self._in_heading = True
            self._current_heading = []
        if tag == "img":
            src = urllib.parse.urljoin(self.page_url, attr.get("src") or attr.get("data-src") or "")
            alt = (attr.get("alt") or "").strip()
            if src and urllib.parse.urlparse(src).scheme in {"http", "https"}:
                self.images.append({"url": src, "alt": alt})
        if tag == "meta" and (attr.get("name") or "").lower() == "description" and attr.get("content"):
            self.text_parts.append(attr["content"] or "")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._breadcrumb_tags:
            marker_index = len(self._breadcrumb_tags) - 1 - self._breadcrumb_tags[::-1].index(tag)
            self._breadcrumb_tags.pop(marker_index)
            self._breadcrumb_depth = max(0, self._breadcrumb_depth - 1)
        if tag in {"script", "style", "nav", "footer", "header", "noscript", "svg"} and self._ignored and not self._breadcrumb_depth:
            self._ignored -= 1
        if tag == "title":
            self._in_title = False
        if tag in {"h1", "h2", "h3"}:
            self._in_heading = False
            heading = " ".join(self._current_heading).strip()
            if heading:
                self.headings.append(heading)
                self.text_parts.append(heading)
        if self._stack:
            try:
                self._stack.reverse()
                self._stack.remove(tag)
                self._stack.reverse()
            except ValueError:
                self._stack.reverse()

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text or self._ignored:
            return
        if self._breadcrumb_depth:
            if text not in self.breadcrumb_parts:
                self.breadcrumb_parts.append(text)
            return
        if self._in_title:
            self.title_parts.append(text)
        else:
            self.text_parts.append(text)
        if self._in_heading:
            self._current_heading.append(text)


def _fetch(url: str, *, timeout: int = 25, allowed_host: str | None = None) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,*/*"},
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if allowed_host and urllib.parse.urlparse(response.geturl()).hostname != allowed_host:
                    raise RuntimeError(f"Refusing cross-host redirect while crawling {url}")
                return response.read(), response.headers.get_content_type()
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(min(2**attempt, 8))
    raise RuntimeError(f"Could not fetch {url}: {last_error}") from last_error


def _sitemap_urls(
    url: str,
    seen_sitemaps: set[str] | None = None,
    allowed_host: str | None = None,
) -> list[tuple[str, str | None]]:
    seen = seen_sitemaps if seen_sitemaps is not None else set()
    if url in seen:
        return []
    seen.add(url)
    host = allowed_host or urllib.parse.urlparse(url).hostname
    raw, _ = _fetch(url, allowed_host=host)
    root = ET.fromstring(raw)
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    result: list[tuple[str, str | None]] = []
    if root.tag.endswith("sitemapindex"):
        for child in root.findall("sm:sitemap/sm:loc", namespace):
            if child.text:
                result.extend(_sitemap_urls(child.text.strip(), seen, host))
        return result
    for node in root.findall("sm:url", namespace):
        loc = node.findtext("sm:loc", default="", namespaces=namespace).strip()
        lastmod = node.findtext("sm:lastmod", default="", namespaces=namespace).strip() or None
        if (
            loc
            and urllib.parse.urlparse(loc).scheme in {"http", "https"}
            and urllib.parse.urlparse(loc).hostname == host
        ):
            result.append((loc, lastmod))
    return result


def _extract(url: str, raw: bytes, content_type: str) -> dict[str, Any] | None:
    if "html" not in content_type and not raw.lstrip().lower().startswith((b"<!doctype html", b"<html")):
        return None
    parser = ArticleParser(url)
    parser.feed(raw.decode("utf-8", errors="replace"))
    content = "\n".join(dict.fromkeys(parser.text_parts))
    if len(content.strip()) < 60:
        return None
    parts = [part for part in urllib.parse.urlparse(url).path.split("/") if part]
    breadcrumbs = list(parser.breadcrumb_parts)
    page_heading = parser.headings[0] if parser.headings else ""
    page_title = " ".join(parser.title_parts).strip() or page_heading
    if breadcrumbs and page_title.casefold().strip() == breadcrumbs[-1].casefold().strip():
        breadcrumbs.pop()
    if len(breadcrumbs) > 2:
        category, folder = breadcrumbs[-2], breadcrumbs[-1]
    elif len(breadcrumbs) == 2:
        category, folder = breadcrumbs[-1], ""
    else:
        category, folder = "Support Center", (parser.headings[1] if len(parser.headings) > 1 else "")
    return {
        "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:24],
        "url": url,
        "title": page_title or parts[-1],
        "category": category,
        "folder": folder,
        "content": content[:100_000],
        "images": parser.images,
        "tags": parser.headings[:30],
    }


def _analyze_images(article: dict[str, Any]) -> None:
    if os.getenv("VISION_ANALYSIS_ENABLED", "false").lower() not in {"1", "true", "yes"}:
        return
    if not ai_provider.configured():
        raise RuntimeError("Image analysis is enabled but OPENAI_API_KEY is not configured.")
    images = article.get("images", [])
    image_urls = [image["url"] for image in images if image.get("url")]
    if not image_urls:
        return
    result = ai_provider.generate_json(
        "Describe only visible interface elements and text that can be read in these product help-center screenshots. "
        "Do not infer undocumented behavior. Return JSON: {descriptions:[{image_url,description,visible_text}]}",
        json.dumps({"article_title": article["title"], "article_text": article["content"][:4000]}),
        image_urls,
    )
    descriptions = result.get("descriptions", [])
    by_url = {
        item.get("image_url"): item
        for item in descriptions
        if isinstance(item, dict) and isinstance(item.get("image_url"), str)
    } if isinstance(descriptions, list) else {}
    for image in images:
        analysis = by_url.get(image.get("url"))
        if analysis:
            image["description"] = str(analysis.get("description", ""))[:2000]
            image["visible_text"] = str(analysis.get("visible_text", ""))[:2000]


def _mark_image_analysis_unavailable(article: dict[str, Any], error: str) -> None:
    for image in article.get("images", []):
        if isinstance(image, dict) and image.get("url"):
            image["analysis_status"] = "unavailable"
            image["analysis_error"] = error[:500]


def status() -> dict[str, Any]:
    storage.initialize()
    with storage.connect() as db:
        run = db.execute(
            "SELECT * FROM crawl_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if run is None:
            return {"status": "idle", "processed": 0, "total": 0}
        processed = json.loads(run["processed_json"])
        urls = json.loads(run["urls_json"])
        return {
            "run_id": run["id"],
            "status": run["status"],
            "processed": len(processed),
            "total": len(urls),
            "error": run["error"],
            "started_at": run["started_at"],
            "finished_at": run["finished_at"],
        }


def start(sitemap_url: str = DEFAULT_SITEMAP, delay_seconds: float | None = None) -> dict[str, Any]:
    storage.initialize()
    if not _worker_lock.acquire(blocking=False):
        return {"status": "already_running", **status()}
    thread = threading.Thread(
        target=_run,
        kwargs={
            "sitemap_url": sitemap_url,
            "delay_seconds": delay_seconds if delay_seconds is not None else float(os.getenv("CRAWL_DELAY_SECONDS", "0.75")),
        },
        daemon=True,
        name="knowledge-sitemap-crawler",
    )
    thread.start()
    return {"status": "started", **status()}


def _run(sitemap_url: str, delay_seconds: float) -> None:
    run_id: int | None = None
    vision_error: str | None = None
    try:
        locations = _sitemap_urls(sitemap_url)
        if not locations:
            raise RuntimeError("Sitemap contained no URLs.")
        max_pages = int(os.getenv("CRAWL_MAX_PAGES", "0"))
        if max_pages > 0:
            locations = locations[:max_pages]
        with storage.connect() as db:
            previous = db.execute(
                "SELECT * FROM crawl_runs WHERE status IN ('running','interrupted','failed') ORDER BY id DESC LIMIT 1"
            ).fetchone()
            normalized_locations = json.loads(json.dumps(locations))
            if previous and previous["sitemap_url"] == sitemap_url and json.loads(previous["urls_json"]) == normalized_locations:
                run_id = previous["id"]
                processed = set(json.loads(previous["processed_json"]))
                db.execute(
                    "UPDATE crawl_runs SET status='running', error=NULL, finished_at=NULL WHERE id=?",
                    (run_id,),
                )
            else:
                cursor = db.execute(
                    "INSERT INTO crawl_runs(status,sitemap_url,urls_json) VALUES('running',?,?)",
                    (sitemap_url, json.dumps(locations)),
                )
                run_id = cursor.lastrowid
                processed = set()
        for page_url, lastmod in locations:
            if page_url in processed:
                continue
            try:
                if lastmod:
                    with storage.connect() as db:
                        unchanged = db.execute(
                            "SELECT 1 FROM articles WHERE url=? AND active=1 AND source='sitemap' AND lastmod=?",
                            (page_url, lastmod),
                        ).fetchone()
                    if unchanged:
                        processed.add(page_url)
                        with storage.connect() as db:
                            db.execute(
                                "UPDATE crawl_runs SET processed_json=? WHERE id=?",
                                (json.dumps(sorted(processed)), run_id),
                            )
                        continue
                raw, content_type = _fetch(page_url, allowed_host=urllib.parse.urlparse(sitemap_url).hostname)
                article = _extract(page_url, raw, content_type)
                if article:
                    if vision_error:
                        _mark_image_analysis_unavailable(article, vision_error)
                    else:
                        try:
                            _analyze_images(article)
                        except ai_provider.AIProviderError as exc:
                            vision_error = str(exc)
                            _mark_image_analysis_unavailable(article, vision_error)
                with storage.connect() as db:
                    if article:
                        storage.store_article(db, article, source="sitemap", lastmod=lastmod)
                    processed.add(page_url)
                    db.execute(
                        "UPDATE crawl_runs SET processed_json=? WHERE id=?",
                        (json.dumps(sorted(processed)), run_id),
                    )
            except Exception as exc:
                with storage.connect() as db:
                    db.execute(
                        "UPDATE crawl_runs SET status='interrupted', processed_json=?, error=? WHERE id=?",
                        (json.dumps(sorted(processed)), str(exc)[:1000], run_id),
                    )
                return
            time.sleep(max(0.0, delay_seconds))

        sitemap_urls = {url for url, _ in locations}
        with storage.connect() as db:
            existing = db.execute("SELECT id,url FROM articles WHERE source='sitemap' AND active=1").fetchall()
            removed = [row["id"] for row in existing if row["url"] and row["url"] not in sitemap_urls]
            for article_id in removed:
                db.execute("UPDATE articles SET active=0 WHERE id=?", (article_id,))
                db.execute("DELETE FROM article_search WHERE article_id=?", (article_id,))
            completion_status = "completed_with_warnings" if vision_error else "completed"
            db.execute(
                "UPDATE crawl_runs SET status=?, error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
                (
                    completion_status,
                    f"Some image analysis was unavailable: {vision_error}" if vision_error else None,
                    run_id,
                ),
            )
    except Exception as exc:
        if run_id is not None:
            with storage.connect() as db:
                db.execute(
                    "UPDATE crawl_runs SET status='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
                    (str(exc)[:1000], run_id),
                )
    finally:
        _worker_lock.release()


def schedule_daily_refresh() -> None:
    if os.getenv("AUTO_REFRESH", "true").lower() not in {"1", "true", "yes"}:
        return

    def schedule() -> None:
        start()
        timer = threading.Timer(24 * 60 * 60, schedule)
        timer.daemon = True
        timer.start()

    timer = threading.Timer(5, schedule)
    timer.daemon = True
    timer.start()
