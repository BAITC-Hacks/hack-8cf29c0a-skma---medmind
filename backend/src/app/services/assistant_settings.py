"""Resolve the shared assistant credential without exposing it in API responses."""

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AssistantCredential


def api_key(db: Session) -> str | None:
    saved = db.get(AssistantCredential, 1)
    return saved.api_key if saved else get_settings().openai_api_key


def status(db: Session) -> dict:
    saved = db.get(AssistantCredential, 1)
    source = "settings" if saved else "environment" if get_settings().openai_api_key else None
    return {"configured": source is not None, "source": source}
