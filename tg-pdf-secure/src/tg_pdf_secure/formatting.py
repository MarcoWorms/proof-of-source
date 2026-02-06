from __future__ import annotations

from tg_pdf_secure.models import CheckResult, ScanReport


def _human_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.2f} MB"


def _status_label(check: CheckResult) -> str:
    if check.status == "ok":
        return "OK"
    if check.status == "warn":
        return "WARN"
    if check.status == "error":
        return "ERROR"
    return "SKIPPED"


def render_report(report: ScanReport) -> str:
    lines = [
        f"PDF scan complete: {report.file_name}",
        f"Size: {_human_size(report.file_size_bytes)}",
        f"SHA256: {report.sha256}",
        f"Verdict: {report.verdict.value}",
        f"Reason: {report.verdict_reason}",
        "",
        "Checks:",
    ]

    for check in report.checks:
        lines.append(f"- {_status_label(check)} | {check.name}: {check.summary}")
        if check.link:
            lines.append(f"  Link: {check.link}")
        if check.details:
            detail_pairs = ", ".join(f"{k}={v}" for k, v in check.details.items() if v is not None)
            if detail_pairs:
                lines.append(f"  Details: {detail_pairs}")

    lines.extend(
        [
            "",
            "Guidance:",
            "- If verdict is UNSAFE or SUSPICIOUS, do not open it on your primary machine.",
            "- Confirm with sender through another channel if the file was expected.",
        ]
    )
    return "\n".join(lines)

