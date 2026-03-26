import time
from collections import deque
from dataclasses import dataclass, field, asdict


@dataclass
class LogEntry:
    timestamp: float = field(default_factory=time.time)
    key_id: str = ""
    key_name: str = ""
    model: str = ""
    status: int = 0
    duration_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    is_stream: bool = False
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


class LogManager:
    def __init__(self, maxlen: int = 1000):
        self._entries: deque[LogEntry] = deque(maxlen=maxlen)

    def add(self, entry: LogEntry):
        self._entries.append(entry)

    def get_recent(self, limit: int = 100, offset: int = 0) -> list[dict]:
        items = list(reversed(self._entries))
        return [e.to_dict() for e in items[offset:offset + limit]]

    @property
    def total(self) -> int:
        return len(self._entries)
