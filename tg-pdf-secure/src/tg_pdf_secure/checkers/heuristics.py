from __future__ import annotations

from pathlib import Path

from tg_pdf_secure.models import CheckResult


class PdfHeuristicChecker:
    name = "Local PDF heuristics"

    _TOKEN_WEIGHTS: dict[bytes, int] = {
        b"/javascript": 30,
        b"/openaction": 30,
        b"/aa": 15,
        b"/launch": 35,
        b"/submitform": 20,
        b"/embeddedfile": 20,
        b"/richmedia": 15,
        b"/objstm": 10,
    }

    async def run(self, pdf_path: Path, _sha256: str) -> CheckResult:
        raw = pdf_path.read_bytes()
        lowered = raw.lower()

        findings: dict[str, int] = {}
        risk_score = 0

        for token, weight in self._TOKEN_WEIGHTS.items():
            count = lowered.count(token)
            if count <= 0:
                continue
            findings[token.decode("ascii")] = count
            risk_score += min(count, 3) * weight

        is_pdf_header = lowered.lstrip().startswith(b"%pdf-")
        if not is_pdf_header:
            findings["invalid_pdf_header"] = 1
            risk_score = max(risk_score, 85)

        if risk_score >= 85:
            status = "warn"
            summary = "High-risk PDF traits found."
        elif risk_score >= 30:
            status = "warn"
            summary = "Suspicious PDF traits found."
        elif findings:
            status = "ok"
            summary = "Potentially risky features present, but low signal."
        else:
            status = "ok"
            summary = "No suspicious PDF traits detected."

        details: dict[str, object] = {"findings": findings}
        if not is_pdf_header:
            details["note"] = "File did not begin with a standard PDF header."

        return CheckResult(
            name=self.name,
            status=status,
            summary=summary,
            risk_score=min(risk_score, 100),
            details=details,
        )
