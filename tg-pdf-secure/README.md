# tg-pdf-secure

Telegram bot that lets you forward PDFs and get a safety assessment before opening them.

## What it does

- Accepts PDF files sent or forwarded to the bot.
- Downloads the PDF, computes `SHA256`.
- Runs two checks:
  - Local PDF heuristics (embedded scripts, launch actions, etc.).
  - VirusTotal cloud scan (if `VT_API_KEY` is set).
- Replies in Telegram with verdict + per-check details.

## Requirements

- Python 3.10+
- A Telegram bot token from BotFather
- Optional: VirusTotal API key

## Setup

1. Install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Create env file:

```bash
cp .env.example .env
```

3. Fill in:

- `TELEGRAM_BOT_TOKEN` (required)
- `VT_API_KEY` (optional but recommended)

4. Run:

```bash
python3 main.py
```

## Usage in Telegram

1. Open your bot chat.
2. Send `/start`.
3. Forward any PDF to the bot.
4. Read verdict:
   - `UNSAFE` = very high confidence risk signal.
   - `SUSPICIOUS` = suspicious indicators found.
   - `LIKELY_SAFE` = current checks found no indicators.
   - `INCONCLUSIVE` = not enough signal (missing/failed checks).

## Optional hardening

- Restrict who can use the bot via `ALLOWED_CHAT_IDS`.
- Lower/raise `MAX_PDF_MB`.
- Tune `VT_POLL_INTERVAL_SECONDS` and `VT_TIMEOUT_SECONDS`.

## Important note

This is a risk triage tool, not a formal guarantee. Even `LIKELY_SAFE` PDFs can still be dangerous in rare cases, especially with zero-day exploits. Use layered defenses.
