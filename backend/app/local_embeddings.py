"""Deterministic lexical vectors for the private planner search index.

Only Muse Spark receives planner text for generation. Search vectors are made
inside the API process, so indexing and retrieval need no model API call.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from typing import List

TOKEN = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset({
    "a", "about", "and", "are", "at", "be", "can", "did", "do", "for", "from",
    "have", "i", "in", "is", "it", "me", "my", "of", "on", "please", "show",
    "the", "to", "what", "when", "which", "who", "will", "with", "you",
})
DIMENSIONS = 768


def _tokens(text: str) -> list[str]:
    return [token for token in TOKEN.findall(text.casefold()) if token not in STOPWORDS]


def has_lexical_overlap(query: str, text: str) -> bool:
    """Reject hash collisions after the private record has been retrieved."""
    return bool(set(_tokens(query)) & set(_tokens(text)))


class LocalEmbeddingClient:
    dimensions = DIMENSIONS

    def _vector(self, text: str, title: str = "") -> List[float]:
        counts = Counter(_tokens(text))
        counts.update({token: 2 for token in set(_tokens(title))})
        vector = [0.0] * self.dimensions
        for token, count in counts.items():
            slot = int.from_bytes(hashlib.sha256(token.encode()).digest()[:4], "big") % self.dimensions
            vector[slot] += 1.0 + math.log(count)
        return vector

    def embed_document(self, text: str, title: str) -> List[float]:
        return self._vector(text, title)

    def embed_query(self, text: str) -> List[float]:
        return self._vector(text)
