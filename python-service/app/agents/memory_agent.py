"""Memory agent: not a graph node in the main run loop, but a small service
used by the API layer to retrieve relevant long-term memories before a run
starts (context injection) and to persist a summary after a run ends."""
from __future__ import annotations

import uuid

from app.memory.store import get_long_term_memory


async def recall(user_id: str, query: str, n_results: int = 5) -> list[dict]:
    store = get_long_term_memory()
    return store.search(user_id=user_id, query=query, n_results=n_results)


async def remember(user_id: str, text: str, metadata: dict | None = None) -> str:
    store = get_long_term_memory()
    doc_id = str(uuid.uuid4())
    store.add(user_id=user_id, doc_id=doc_id, text=text, metadata=metadata)
    return doc_id
