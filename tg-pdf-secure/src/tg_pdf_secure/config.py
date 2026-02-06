from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


def _parse_chat_ids(raw_value: str | None) -> set[int]:
    if not raw_value:
        return set()

    output: set[int] = set()
    for chunk in raw_value.split(","):
        cleaned = chunk.strip()
        if not cleaned:
            continue
        try:
            output.add(int(cleaned))
        except ValueError as exc:
            raise ValueError(f"Invalid chat id in ALLOWED_CHAT_IDS: {cleaned!r}") from exc
    return output


def _read_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {value!r}") from exc


def _read_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a float, got {value!r}") from exc


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    vt_api_key: str | None
    allowed_chat_ids: set[int]
    max_pdf_mb: int
    vt_poll_interval_seconds: float
    vt_timeout_seconds: int
    log_level: str

    @property
    def max_pdf_bytes(self) -> int:
        return self.max_pdf_mb * 1024 * 1024


def load_settings() -> Settings:
    load_dotenv()

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not bot_token:
        raise ValueError("TELEGRAM_BOT_TOKEN is required.")

    vt_api_key = os.getenv("VT_API_KEY", "").strip() or None
    return Settings(
        telegram_bot_token=bot_token,
        vt_api_key=vt_api_key,
        allowed_chat_ids=_parse_chat_ids(os.getenv("ALLOWED_CHAT_IDS")),
        max_pdf_mb=_read_int("MAX_PDF_MB", 30),
        vt_poll_interval_seconds=_read_float("VT_POLL_INTERVAL_SECONDS", 6.0),
        vt_timeout_seconds=_read_int("VT_TIMEOUT_SECONDS", 180),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO",
    )

