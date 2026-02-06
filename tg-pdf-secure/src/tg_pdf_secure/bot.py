from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from tg_pdf_secure.checkers import PdfHeuristicChecker, VirusTotalChecker
from tg_pdf_secure.config import Settings, load_settings
from tg_pdf_secure.formatting import render_report
from tg_pdf_secure.scanner import ScanOrchestrator

LOGGER = logging.getLogger(__name__)


def _is_allowed_chat(chat_id: int, settings: Settings) -> bool:
    if not settings.allowed_chat_ids:
        return True
    return chat_id in settings.allowed_chat_ids


def _build_scanner(settings: Settings) -> ScanOrchestrator:
    checkers = [
        PdfHeuristicChecker(),
        VirusTotalChecker(
            api_key=settings.vt_api_key,
            poll_interval_seconds=settings.vt_poll_interval_seconds,
            timeout_seconds=settings.vt_timeout_seconds,
        ),
    ]
    return ScanOrchestrator(checkers=checkers)


def build_application(settings: Settings) -> Application:
    scanner = _build_scanner(settings)
    application = Application.builder().token(settings.telegram_bot_token).build()

    async def start_handler(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        await update.message.reply_text(
            "Forward me a PDF and I will scan it with local heuristics and VirusTotal."
        )

    async def help_handler(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        await update.message.reply_text(
            "How to use:\n"
            "1) Forward a PDF to this bot.\n"
            "2) Wait for scan results.\n"
            "3) Review verdict and links before opening file.\n\n"
            "Commands:\n"
            "/start\n"
            "/help\n"
            "/status"
        )

    async def status_handler(update: Update, _context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        cloud_status = "enabled" if settings.vt_api_key else "disabled (set VT_API_KEY)"
        chat_scope = (
            "open to all chats"
            if not settings.allowed_chat_ids
            else f"restricted to {len(settings.allowed_chat_ids)} chat id(s)"
        )
        await update.message.reply_text(
            f"Bot status:\n"
            f"- Cloud scan (VirusTotal): {cloud_status}\n"
            f"- Max PDF size: {settings.max_pdf_mb} MB\n"
            f"- Access: {chat_scope}"
        )

    async def pdf_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message or not update.message.document or not update.effective_chat:
            return
        chat_id = update.effective_chat.id

        if not _is_allowed_chat(chat_id, settings):
            await update.message.reply_text("This bot is not allowed in this chat.")
            return

        doc = update.message.document
        file_size = doc.file_size or 0
        file_name = doc.file_name or "document.pdf"

        if file_size > settings.max_pdf_bytes:
            await update.message.reply_text(
                f"File too large ({file_size / (1024 * 1024):.2f} MB). "
                f"Max allowed is {settings.max_pdf_mb} MB."
            )
            return

        status_message = await update.message.reply_text("Downloading and scanning PDF...")
        temp_path: Path | None = None
        try:
            telegram_file = await context.bot.get_file(doc.file_id)
            with tempfile.NamedTemporaryFile(
                suffix=".pdf",
                prefix="tg-pdf-secure-",
                delete=False,
            ) as temp_file:
                temp_path = Path(temp_file.name)

            await telegram_file.download_to_drive(custom_path=str(temp_path))

            if file_size <= 0:
                file_size = temp_path.stat().st_size

            report = await scanner.scan(
                pdf_path=temp_path,
                file_name=file_name,
                file_size_bytes=file_size,
            )
            await status_message.edit_text(render_report(report))
        except Exception:  # noqa: BLE001
            LOGGER.exception("Failed to process PDF.")
            await status_message.edit_text(
                "Failed to process that PDF due to an internal error."
            )
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)

    async def other_document_handler(
        update: Update, _context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if not update.message:
            return
        await update.message.reply_text("Send a PDF document. Other file types are ignored.")

    async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        LOGGER.exception("Unhandled exception for update %s", update, exc_info=context.error)

    application.add_handler(CommandHandler("start", start_handler))
    application.add_handler(CommandHandler("help", help_handler))
    application.add_handler(CommandHandler("status", status_handler))
    application.add_handler(MessageHandler(filters.Document.PDF, pdf_handler))
    application.add_handler(
        MessageHandler(filters.Document.ALL & ~filters.Document.PDF, other_document_handler)
    )
    application.add_error_handler(error_handler)

    return application


def run_bot() -> None:
    settings = load_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    app = build_application(settings)
    app.run_polling(drop_pending_updates=True)

