from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal


class Verdict(str, Enum):
    LIKELY_SAFE = "LIKELY_SAFE"
    SUSPICIOUS = "SUSPICIOUS"
    UNSAFE = "UNSAFE"
    INCONCLUSIVE = "INCONCLUSIVE"


CheckStatus = Literal["ok", "warn", "error", "skipped"]


@dataclass
class CheckResult:
    name: str
    status: CheckStatus
    summary: str
    risk_score: int = 0
    details: dict[str, Any] = field(default_factory=dict)
    link: str | None = None


@dataclass
class ScanReport:
    file_name: str
    file_size_bytes: int
    sha256: str
    verdict: Verdict
    verdict_reason: str
    checks: list[CheckResult]

