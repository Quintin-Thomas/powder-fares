"""Price-source interface. Swap GoogleFlights for a paid API by implementing `search()`."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Protocol


@dataclass(frozen=True)
class Itinerary:
    origin: str
    dest: str
    depart: date
    ret: date | None = None  # None = one-way

    def key(self) -> str:
        return f"{self.origin}-{self.dest}|{self.depart.isoformat()}|{self.ret.isoformat() if self.ret else ''}"


@dataclass
class Quote:
    price: int  # fare, all passengers, before bag fees
    airlines: list[str]
    stops: int
    depart_time: str | None = None  # "HH:MM" local, first segment
    arrive_time: str | None = None  # "HH:MM" local, last segment


@dataclass
class SearchResult:
    itinerary: Itinerary
    quotes: list[Quote]
    url: str
    typical_low: int | None = None
    typical_high: int | None = None
    typical: int | None = None
    history: dict[str, int] = field(default_factory=dict)  # day -> lowest fare that day (all airlines)
    currency: str = "USD"

    def cheapest(self, cost=lambda q: q.price) -> Quote | None:
        return min(self.quotes, key=cost) if self.quotes else None


class PriceSource(Protocol):
    name: str

    def search(self, it: Itinerary) -> SearchResult | None: ...
