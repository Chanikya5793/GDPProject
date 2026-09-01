from __future__ import annotations

import re
from typing import List, Optional

_SIMPLE_ESCAPES = {
    '"': '"', "\\": "\\", "/": "/",
    "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t",
}


class JsonStringFieldStreamer:
    """Decode one string field of a JSON document while the document arrives.

    The model answers with a whole JSON object (answer, citation_ids, action),
    so there is no plain-text stream to forward. This pulls the prose out of
    ``answer`` as the bytes land, which is what makes a token-by-token reply
    possible without giving up the structured output the rest of the pipeline
    depends on.

    ``feed`` returns only the text decoded since the previous call, so a caller
    can forward each return value straight to the client. It never returns a
    partially decoded escape: an escape split across two chunks stays buffered
    until the rest of it arrives.
    """

    def __init__(self, field: str):
        # Anchored on `{` or `,` so a field name occurring inside some earlier
        # string value cannot be mistaken for the key itself.
        self._pattern = re.compile(r'(?:^|[{,])\s*"' + re.escape(field) + r'"\s*:\s*"')
        self._buffer = ""
        self._cursor: Optional[int] = None
        self.closed = False

    @property
    def document(self) -> str:
        """Everything received so far, including whatever followed the field."""
        return self._buffer

    def feed(self, chunk: str) -> str:
        self._buffer += chunk
        if self.closed:
            return ""
        if self._cursor is None:
            match = self._pattern.search(self._buffer)
            if not match:
                return ""
            self._cursor = match.end()
        decoded: List[str] = []
        index = self._cursor
        buffer = self._buffer
        end = len(buffer)
        while index < end:
            char = buffer[index]
            if char == '"':
                self.closed = True
                index += 1
                break
            if char != "\\":
                decoded.append(char)
                index += 1
                continue
            if index + 2 > end:
                break
            escape = buffer[index + 1]
            if escape != "u":
                decoded.append(_SIMPLE_ESCAPES.get(escape, escape))
                index += 2
                continue
            if index + 6 > end:
                break
            try:
                code = int(buffer[index + 2:index + 6], 16)
            except ValueError:
                decoded.append(buffer[index:index + 6])
                index += 6
                continue
            if 0xD800 <= code <= 0xDBFF:
                # Half of a surrogate pair. Emitting it alone would produce a
                # lone surrogate, which cannot be encoded as UTF-8 and would
                # kill the response mid-stream, so wait for its partner.
                if index + 12 > end:
                    break
                low = -1
                if buffer[index + 6:index + 8] == "\\u":
                    try:
                        low = int(buffer[index + 8:index + 12], 16)
                    except ValueError:
                        low = -1
                if 0xDC00 <= low <= 0xDFFF:
                    decoded.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
                    index += 12
                    continue
                index += 6
                continue
            if 0xDC00 <= code <= 0xDFFF:
                index += 6
                continue
            decoded.append(chr(code))
            index += 6
        self._cursor = index
        return "".join(decoded)
