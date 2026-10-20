from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = Path(os.getenv("KNOWLEDGE_DB_PATH", str(DATA_DIR / "knowledge.db")))
SEED_PATH = DATA_DIR / "knowledge.json"
STOP_WORDS = {
    "about", "after", "also", "and", "are", "can", "could", "does", "for", "from", "get",
    "have", "how", "into", "its", "need", "our", "please", "that", "the", "their", "them",
    "then", "there", "this", "through", "what", "when", "where", "which", "with", "would",
    "you", "your",
}


def _search_terms(text: str) -> set[str]:
    roots: set[str] = set()
    for token in re.findall(r"[a-z0-9]+", text.casefold()):
        if len(token) <= 2 or token in STOP_WORDS:
            continue
        roots.add(token)
        if token.endswith("ies") and len(token) > 4:
            roots.add(token[:-3] + "y")
        elif token.endswith("ing") and len(token) > 5:
            roots.add(token[:-3])
        elif token.endswith("ed") and len(token) > 4:
            roots.add(token[:-2])
        elif token.endswith("s") and not token.endswith("ss") and len(token) > 4:
            roots.add(token[:-1])
    return roots


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS articles (
                id TEXT PRIMARY KEY,
                url TEXT UNIQUE,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                folder TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                images_json TEXT NOT NULL DEFAULT '[]',
                tags_json TEXT NOT NULL DEFAULT '[]',
                content_hash TEXT NOT NULL,
                lastmod TEXT,
                source TEXT NOT NULL DEFAULT 'demo',
                active INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
                article_id UNINDEXED, title, category, folder, content, tags, images,
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE TABLE IF NOT EXISTS expert_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                answer TEXT,
                expert_name TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                answered_at TEXT
            );
            CREATE TABLE IF NOT EXISTS crawl_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL,
                sitemap_url TEXT NOT NULL,
                urls_json TEXT NOT NULL,
                processed_json TEXT NOT NULL DEFAULT '[]',
                error TEXT,
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                finished_at TEXT
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        count = db.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
        if count == 0 and SEED_PATH.exists():
            try:
                seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                seed = {}
            for article in seed.get("articles", []):
                store_article(db, article, source="demo")


def _hash(article: dict[str, Any]) -> str:
    data = json.dumps(
        {key: article.get(key) for key in ("title", "category", "folder", "content", "images", "tags")},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def store_article(
    db: sqlite3.Connection,
    article: dict[str, Any],
    *,
    source: str,
    lastmod: str | None = None,
) -> bool:
    article_id = str(article.get("id") or hashlib.sha256(str(article.get("url", "")).encode()).hexdigest()[:24])
    article.update(id=article_id, source=source)
    content_hash = _hash(article)
    existing = db.execute(
        "SELECT content_hash FROM articles WHERE id=? OR (url IS NOT NULL AND url=?)",
        (article_id, article.get("url")),
    ).fetchone()
    if existing and existing["content_hash"] == content_hash:
        db.execute(
            "UPDATE articles SET active=1, lastmod=COALESCE(?, lastmod), source=? WHERE id=? OR url=?",
            (lastmod, source, article_id, article.get("url")),
        )
        return False

    db.execute(
        """
        INSERT INTO articles(id,url,title,category,folder,content,images_json,tags_json,content_hash,lastmod,source,active,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            url=excluded.url, title=excluded.title, category=excluded.category,
            folder=excluded.folder, content=excluded.content,
            images_json=excluded.images_json, tags_json=excluded.tags_json,
            content_hash=excluded.content_hash, lastmod=excluded.lastmod,
            source=excluded.source, active=1, updated_at=CURRENT_TIMESTAMP
        """,
        (
            article_id,
            article.get("url"),
            str(article.get("title") or "Untitled article"),
            str(article.get("category") or ""),
            str(article.get("folder") or ""),
            str(article.get("content") or ""),
            json.dumps(article.get("images", []), ensure_ascii=False),
            json.dumps(article.get("tags", []), ensure_ascii=False),
            content_hash,
            lastmod,
            source,
        ),
    )
    db.execute("DELETE FROM article_search WHERE article_id=?", (article_id,))
    db.execute(
        "INSERT INTO article_search(article_id,title,category,folder,content,tags,images) VALUES(?,?,?,?,?,?,?)",
        (
            article_id,
            str(article.get("title") or ""),
            str(article.get("category") or ""),
            str(article.get("folder") or ""),
            str(article.get("content") or ""),
            " ".join(article.get("tags", [])),
            " ".join(
                " ".join(
                    text for text in (
                        image.get("alt", ""),
                        image.get("description", ""),
                    ) if text
                ) if isinstance(image, dict) else str(image)
                for image in article.get("images", [])
            ),
        ),
    )
    return True


def article_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "url": row["url"],
        "title": row["title"],
        "category": row["category"],
        "folder": row["folder"],
        "content": row["content"],
        "images": json.loads(row["images_json"]),
        "tags": json.loads(row["tags_json"]),
        "source": row["source"],
        "updated_at": row["updated_at"],
    }


def all_articles() -> list[dict[str, Any]]:
    initialize()
    with connect() as db:
        rows = db.execute("SELECT * FROM articles WHERE active=1 ORDER BY category,title").fetchall()
        return [article_dict(row) for row in rows]


def search_articles(question: str, limit: int = 5) -> list[dict[str, Any]]:
    initialize()
    terms = _search_terms(question)
    if not terms:
        return []
    query = " OR ".join('"' + term.replace('"', '""') + '"' for term in sorted(terms)[:60])
    with connect() as db:
        try:
            rows = db.execute(
                """
                SELECT a.*, bm25(article_search, 0, 5, 2, 2, 1, 1, 0.5) AS rank
                FROM article_search JOIN articles a ON a.id=article_search.article_id
                WHERE article_search MATCH ? AND a.active=1
                ORDER BY rank LIMIT ?
                """,
                (query, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        results: list[dict[str, Any]] = []
        minimum_overlap = 2 if len(set(terms)) >= 6 else 1
        for row in rows:
            article = article_dict(row)
            article_terms = _search_terms(
                " ".join(
                    [
                        article["title"],
                        article["category"],
                        article["folder"],
                        article["content"],
                        " ".join(article["tags"]),
                        " ".join(
                            f"{image.get('alt', '')} {image.get('description', '')}"
                            if isinstance(image, dict)
                            else str(image)
                            for image in article["images"]
                        ),
                    ]
                )
            )
            overlap = set(terms) & article_terms
            if len(overlap) >= minimum_overlap:
                results.append(article)
        return results
