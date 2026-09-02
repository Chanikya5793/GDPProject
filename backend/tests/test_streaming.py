from __future__ import annotations

import json

import pytest

from app.streaming import JsonStringFieldStreamer


def drip(document: str, size: int = 1):
    """Feed a document one small chunk at a time, as the wire would."""
    streamer = JsonStringFieldStreamer("answer")
    out = []
    for start in range(0, len(document), size):
        out.append(streamer.feed(document[start:start + size]))
    return "".join(out), streamer


@pytest.mark.parametrize("size", [1, 2, 3, 5, 13, 500])
def test_decodes_the_field_at_any_chunk_boundary(size):
    text = 'Start with Physics lab prep. It\'s due Sept 6 [S1].'
    document = json.dumps({"answer": text, "citation_ids": ["S1"], "action": None})
    decoded, streamer = drip(document, size)
    assert decoded == text
    assert streamer.closed


@pytest.mark.parametrize("size", [1, 2, 5])
def test_escapes_split_across_chunks_are_never_half_emitted(size):
    text = 'She said "hi" then left.\nBack slash \\ and a tab\there.'
    document = json.dumps({"answer": text})
    decoded, _ = drip(document, size)
    assert decoded == text


@pytest.mark.parametrize("size", [1, 3, 7])
def test_surrogate_pairs_survive_chunking(size):
    # A lone surrogate cannot be encoded as UTF-8, so a half-emitted pair would
    # take the whole response down rather than just garble a character.
    text = "Nice work \U0001F600 keep going"
    document = json.dumps({"answer": text})  # ensure_ascii writes 😀
    assert "\\ud83d" in document
    decoded, _ = drip(document, size)
    assert decoded == text
    decoded.encode("utf-8")


def test_stops_at_the_closing_quote_and_ignores_later_fields():
    document = json.dumps({"answer": "Done.", "citation_ids": ["S1"], "action": None})
    decoded, streamer = drip(document, 1)
    assert decoded == "Done."
    assert streamer.closed
    # The rest of the document is still captured for structured parsing.
    assert json.loads(streamer.document)["citation_ids"] == ["S1"]


def test_ignores_the_field_name_inside_an_earlier_string_value():
    document = json.dumps({"note": 'the "answer": "decoy"', "answer": "real"})
    decoded, _ = drip(document, 1)
    assert decoded == "real"


def test_field_missing_yields_nothing_but_keeps_the_document():
    streamer = JsonStringFieldStreamer("answer")
    assert streamer.feed('{"citation_ids": []}') == ""
    assert not streamer.closed
    assert streamer.document == '{"citation_ids": []}'


def test_field_arriving_after_other_keys_is_still_found():
    document = json.dumps({"citation_ids": ["S1"], "answer": "Later field."})
    decoded, streamer = drip(document, 4)
    assert decoded == "Later field."
    assert streamer.closed


def test_empty_string_value_closes_immediately():
    decoded, streamer = drip(json.dumps({"answer": ""}), 1)
    assert decoded == ""
    assert streamer.closed


def test_unicode_escape_decodes():
    document = json.dumps({"answer": "café"}, ensure_ascii=True)
    decoded, _ = drip(document, 1)
    assert decoded == "café"
