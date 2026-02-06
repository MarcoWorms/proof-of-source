from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Protocol

from tg_pdf_secure.models import CheckResult, ScanReport, Verdict


class PdfChecker(Protocol):
    name: str

    async def run(self, pdf_path: Path, sha256: str) -> CheckResult:
        ...


def _hash_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ScanOrchestrator:
    def __init__(self, checkers: list[PdfChecker]) -> None:
        self._checkers = checkers

    async def scan(self, pdf_path: Path, file_name: str, file_size_bytes: int) -> ScanReport:
        sha256 = _hash_sha256(pdf_path)
        check_results: list[CheckResult] = []

        for checker in self._checkers:
            try:
                result = await checker.run(pdf_path, sha256)
            except Exception as exc:  # noqa: BLE001
                result = CheckResult(
                    name=checker.name,
                    status="error",
                    summary=f"Checker failed: {exc.__class__.__name__}",
                    risk_score=45,
                )
            check_results.append(result)

        verdict, reason = self._compute_verdict(check_results)
        return ScanReport(
            file_name=file_name,
            file_size_bytes=file_size_bytes,
            sha256=sha256,
            verdict=verdict,
            verdict_reason=reason,
            checks=check_results,
        )

    def _compute_verdict(self, checks: list[CheckResult]) -> tuple[Verdict, str]:
        highest_risk = max((check.risk_score for check in checks), default=50)
        has_warn = any(check.status == "warn" for check in checks)
        has_ok = any(check.status == "ok" for check in checks)
        has_error = any(check.status == "error" for check in checks)
        all_skipped = all(check.status == "skipped" for check in checks) if checks else True

        if highest_risk >= 90:
            return Verdict.UNSAFE, "At least one check raised a high-confidence malware signal."
        if has_warn:
            return Verdict.SUSPICIOUS, "At least one check found suspicious indicators."
        if all_skipped:
            return Verdict.INCONCLUSIVE, "No checks were executed."
        if has_error and not has_ok:
            return Verdict.INCONCLUSIVE, "Checks failed before a clean signal was established."
        if has_error and has_ok:
            return Verdict.SUSPICIOUS, "Some checks failed; treating result conservatively."
        return Verdict.LIKELY_SAFE, "No current check raised suspicious indicators."

