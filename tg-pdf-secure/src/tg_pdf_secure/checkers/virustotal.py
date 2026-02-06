from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx

from tg_pdf_secure.models import CheckResult


class VirusTotalChecker:
    name = "VirusTotal"
    _BASE_URL = "https://www.virustotal.com/api/v3"
    _SMALL_FILE_LIMIT_BYTES = 32 * 1024 * 1024

    def __init__(
        self,
        api_key: str | None,
        poll_interval_seconds: float = 6.0,
        timeout_seconds: int = 180,
    ) -> None:
        self._api_key = api_key
        self._poll_interval = poll_interval_seconds
        self._timeout_seconds = timeout_seconds

    async def run(self, pdf_path: Path, sha256: str) -> CheckResult:
        if not self._api_key:
            return CheckResult(
                name=self.name,
                status="skipped",
                summary="VT_API_KEY not set. Cloud malware scan skipped.",
                risk_score=20,
            )

        headers = {"x-apikey": self._api_key}
        timeout = httpx.Timeout(30.0, read=45.0)
        async with httpx.AsyncClient(base_url=self._BASE_URL, timeout=timeout) as client:
            existing = await self._get_file_report(client, headers, sha256)
            if existing is None:
                if pdf_path.stat().st_size > self._SMALL_FILE_LIMIT_BYTES:
                    return CheckResult(
                        name=self.name,
                        status="skipped",
                        summary=(
                            "File is larger than 32 MB and cannot be uploaded with the "
                            "basic VirusTotal endpoint."
                        ),
                        risk_score=25,
                    )
                analysis_id = await self._upload_for_analysis(client, headers, pdf_path)
                if not analysis_id:
                    return CheckResult(
                        name=self.name,
                        status="error",
                        summary="Upload to VirusTotal failed.",
                        risk_score=50,
                    )
                existing = await self._wait_for_report(client, headers, analysis_id, sha256)

            if not existing:
                return CheckResult(
                    name=self.name,
                    status="error",
                    summary="VirusTotal did not return a completed report in time.",
                    risk_score=50,
                )

            return self._build_result(existing, sha256)

    async def _get_file_report(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        sha256: str,
    ) -> dict[str, Any] | None:
        response = await client.get(f"/files/{sha256}", headers=headers)
        if response.status_code == 404:
            return None
        if response.status_code == 429:
            return {"rate_limited": True}
        response.raise_for_status()
        payload = response.json()
        attributes = payload.get("data", {}).get("attributes", {})
        return {
            "stats": attributes.get("last_analysis_stats", {}),
            "analysis_date": attributes.get("last_analysis_date"),
            "reputation": attributes.get("reputation"),
        }

    async def _upload_for_analysis(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        pdf_path: Path,
    ) -> str | None:
        if pdf_path.stat().st_size > self._SMALL_FILE_LIMIT_BYTES:
            return None

        with pdf_path.open("rb") as file_stream:
            files = {"file": (pdf_path.name, file_stream, "application/pdf")}
            response = await client.post("/files", headers=headers, files=files)
            if response.status_code == 429:
                return None
            response.raise_for_status()
            payload = response.json()
            return payload.get("data", {}).get("id")

    async def _wait_for_report(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        analysis_id: str,
        sha256: str,
    ) -> dict[str, Any] | None:
        deadline = time.monotonic() + self._timeout_seconds

        while time.monotonic() < deadline:
            response = await client.get(f"/analyses/{analysis_id}", headers=headers)
            if response.status_code == 429:
                await asyncio.sleep(self._poll_interval)
                continue

            response.raise_for_status()
            payload = response.json()
            attributes = payload.get("data", {}).get("attributes", {})
            status = attributes.get("status")

            if status == "completed":
                report = await self._get_file_report(client, headers, sha256)
                if report and not report.get("rate_limited"):
                    return report
                stats = attributes.get("stats", {})
                return {"stats": stats, "analysis_date": None, "reputation": None}

            await asyncio.sleep(self._poll_interval)

        return None

    def _build_result(self, report: dict[str, Any], sha256: str) -> CheckResult:
        if report.get("rate_limited"):
            return CheckResult(
                name=self.name,
                status="error",
                summary="VirusTotal API rate limit reached.",
                risk_score=45,
                link=f"https://www.virustotal.com/gui/file/{sha256}/detection",
            )

        stats = report.get("stats") or {}
        malicious = int(stats.get("malicious", 0))
        suspicious = int(stats.get("suspicious", 0))
        harmless = int(stats.get("harmless", 0))
        undetected = int(stats.get("undetected", 0))
        timeout = int(stats.get("timeout", 0))
        failure = int(stats.get("failure", 0))

        if malicious > 0:
            status = "warn"
            risk_score = 97
            summary = f"{malicious} engine(s) marked this file as malicious."
        elif suspicious > 0:
            status = "warn"
            risk_score = 72
            summary = f"{suspicious} engine(s) marked this file as suspicious."
        else:
            status = "ok"
            risk_score = 5
            summary = "No engine flagged this file as malicious or suspicious."

        return CheckResult(
            name=self.name,
            status=status,
            summary=summary,
            risk_score=risk_score,
            details={
                "malicious": malicious,
                "suspicious": suspicious,
                "harmless": harmless,
                "undetected": undetected,
                "timeout": timeout,
                "failure": failure,
                "analysis_date": report.get("analysis_date"),
                "reputation": report.get("reputation"),
            },
            link=f"https://www.virustotal.com/gui/file/{sha256}/detection",
        )
