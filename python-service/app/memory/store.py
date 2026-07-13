"""
Memory system for the Python agents.

Two tiers, matching the JS side's existing `memories` table (short-lived,
per-conversation) plus the RAG system planned for JS Milestone 15:

  - Short-term memory: in-process, per-session deque, cleared on session end.
  - Long-term memory: ChromaDB collection per user, persisted to disk,
    embedded and retrievable by semantic similarity.

This does not replace the Supabase `memories` table — the TS app remains
the source of truth for what the user sees in the /memory page. This store
is additive: it's what lets the Python agents do semantic recall over past
sessions/results, which Postgres text search doesn't give you cheaply.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import chromadb
from chromadb.utils import embedding_functions

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("memory.store")


@dataclass
class ShortTermMemory:
    """Per-session rolling buffer. Capped like the JS side caps timeline/
    tool_history (last N entries) to keep context bounded."""

    max_items: int = 100
    _items: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=100))

    def __post_init__(self) -> None:
        self._items = deque(maxlen=self.max_items)

    def add(self, kind: str, content: str, metadata: dict | None = None) -> None:
        self._items.append(
            {"kind": kind, "content": content, "metadata": metadata or {}, "ts": time.time()}
        )

    def recent(self, n: int = 20) -> list[dict[str, Any]]:
        return list(self._items)[-n:]

    def compress(self) -> str:
        """Cheap context compression: join recent items into a single block
        for injection into a prompt. A real summarization pass (via the
        planner model) can replace this later without changing the interface."""
        return "\n".join(f"[{i['kind']}] {i['content']}" for i in self._items)


class LongTermMemory:
    """ChromaDB-backed persistent, per-user semantic memory."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        self._embedder = embedding_functions.DefaultEmbeddingFunction()

    def _collection(self, user_id: str):
        name = f"user_{user_id}"[:63]  # Chroma collection name length limit
        return self._client.get_or_create_collection(name=name, embedding_function=self._embedder)

    def add(self, user_id: str, doc_id: str, text: str, metadata: dict | None = None) -> None:
        try:
            self._collection(user_id).upsert(
                ids=[doc_id], documents=[text], metadatas=[metadata or {}]
            )
        except Exception:  # noqa: BLE001 — memory writes must never crash a run
            logger.warn("long_term_memory_write_failed", user_id=user_id, doc_id=doc_id)

    def search(self, user_id: str, query: str, n_results: int = 5) -> list[dict[str, Any]]:
        try:
            result = self._collection(user_id).query(query_texts=[query], n_results=n_results)
        except Exception:  # noqa: BLE001
            logger.warn("long_term_memory_query_failed", user_id=user_id)
            return []

        docs = result.get("documents") or [[]]
        metas = result.get("metadatas") or [[]]
        dists = result.get("distances") or [[]]
        out: list[dict[str, Any]] = []
        for doc, meta, dist in zip(docs[0], metas[0], dists[0]):
            out.append({"text": doc, "metadata": meta, "distance": dist})
        return out

    def cleanup(self, user_id: str, keep_ids: set[str]) -> None:
        """Delete anything not in keep_ids — used for periodic pruning."""
        coll = self._collection(user_id)
        existing = coll.get()["ids"]
        stale = [i for i in existing if i not in keep_ids]
        if stale:
            coll.delete(ids=stale)


_long_term_singleton: LongTermMemory | None = None


def get_long_term_memory() -> LongTermMemory:
    global _long_term_singleton
    if _long_term_singleton is None:
        _long_term_singleton = LongTermMemory()
    return _long_term_singleton
