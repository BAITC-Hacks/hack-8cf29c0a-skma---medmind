"""«Ленивый режим»: чат с ИИ-ассистентом по данным закупок + загрузка файлов для прогноза."""

import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import models
from app.assistant import agent
from app.assistant import schemas as s
from app.db import get_db
from app.services import assistant_files as af
from app.services.assistant_settings import api_key

router = APIRouter(prefix="/assistant", tags=["assistant"])

_MODE_DESCRIPTIONS = {
    "fast": "Быстрые справки: «сколько заказать X», «что срочно»",
    "standard": "Анализ данных, графики, прогноз по файлам — по умолчанию",
    "deep": "Сложные разборы: сравнения, аномалии, большие файлы",
}


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _conversation(db: Session, conversation_id: str) -> models.AssistantConversation:
    conv = db.get(models.AssistantConversation, conversation_id)
    if conv is None:
        raise HTTPException(404, "Диалог не найден")
    return conv


@router.get("/status", response_model=s.AssistantStatus)
def status(db: Session = Depends(get_db)):
    enabled = bool(api_key(db))
    return s.AssistantStatus(
        enabled=enabled,
        reason=None if enabled else "Не добавлен API-ключ",
        models=[s.ModelInfo(mode=m, model=agent.model_for(m), description=d) for m, d in _MODE_DESCRIPTIONS.items()],
    )


@router.get("/conversations", response_model=list[s.Conversation])
def list_conversations(db: Session = Depends(get_db)):
    return db.scalars(select(models.AssistantConversation)
                      .order_by(models.AssistantConversation.updated_at.desc()).limit(100)).all()


@router.post("/conversations", response_model=s.Conversation, status_code=201)
def create_conversation(body: s.ConversationCreate | None = None, db: Session = Depends(get_db)):
    now = datetime.now()
    title = body.title if body and body.title else "Новый диалог"
    conv = models.AssistantConversation(id=_new_id(), title=title, created_at=now, updated_at=now)
    db.add(conv)
    db.commit()
    return conv


@router.get("/conversations/{conversation_id}", response_model=s.ConversationDetail)
def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    conv = _conversation(db, conversation_id)
    messages = db.scalars(select(models.AssistantMessage).where(
        models.AssistantMessage.conversation_id == conv.id).order_by(models.AssistantMessage.created_at)).all()
    files = db.scalars(select(models.AssistantFile).where(
        models.AssistantFile.conversation_id == conv.id).order_by(models.AssistantFile.created_at)).all()
    return s.ConversationDetail(
        id=conv.id, title=conv.title, created_at=conv.created_at, updated_at=conv.updated_at,
        messages=[s.Message.model_validate(m) for m in messages],
        files=[s.FileInfo.model_validate(f) for f in files],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)):
    conv = _conversation(db, conversation_id)
    db.execute(delete(models.AssistantMessage).where(models.AssistantMessage.conversation_id == conv.id))
    db.execute(delete(models.AssistantFile).where(models.AssistantFile.conversation_id == conv.id))
    db.delete(conv)
    db.commit()


@router.post("/conversations/{conversation_id}/files", response_model=s.FileInfo, status_code=201)
async def upload_file(conversation_id: str, file: Annotated[UploadFile, File()], db: Session = Depends(get_db)):
    """CSV/XLSX до 20 МБ: «Дата | Код | Количество» (как «Динамика продаж») или «Товар | янв. 2025 | …».
    Файл разбирается на сервере; модель получает только сводку и агрегаты."""
    conv = _conversation(db, conversation_id)
    blob = await file.read(af.MAX_FILE_BYTES + 1)
    filename = file.filename or "file"
    try:
        df = af.load_table(blob, filename)
        summary = af.summarize(df, af.detect_schema(df))
    except af.FileParseError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = models.AssistantFile(id=_new_id(), conversation_id=conv.id, filename=filename[:255], size=len(blob),
                               content=blob, summary=summary, created_at=datetime.now())
    db.add(row)
    conv.updated_at = row.created_at
    db.commit()
    return row


@router.post("/conversations/{conversation_id}/messages", response_model=s.TurnOut)
def send_message(conversation_id: str, body: s.MessageCreate, db: Session = Depends(get_db)):
    """Вопрос ассистенту. Ответ синхронный (5–60 с в зависимости от режима и числа вызовов инструментов)."""
    conv = _conversation(db, conversation_id)
    last_at = db.scalar(select(func.max(models.AssistantMessage.created_at))
                        .where(models.AssistantMessage.conversation_id == conv.id))
    asked_at = max(datetime.now(), last_at + timedelta(microseconds=1)) if last_at else datetime.now()
    if body.file_ids:
        own = set(db.scalars(select(models.AssistantFile.id).where(
            models.AssistantFile.conversation_id == conv.id, models.AssistantFile.id.in_(body.file_ids))))
        if missing := set(body.file_ids) - own:
            raise HTTPException(404, f"Файлы не найдены в этом диалоге: {', '.join(sorted(missing))}")
    try:
        result = agent.run_turn(db, conv.id, body.content, body.file_ids, body.mode)
    except agent.AssistantDisabled as exc:
        raise HTTPException(503, str(exc)) from exc
    except agent.AssistantUpstreamError as exc:
        raise HTTPException(502, str(exc)) from exc

    # порядок сообщений задаётся временем: ответ строго позже вопроса даже при грубом таймере ОС
    answered_at = max(datetime.now(), asked_at + timedelta(microseconds=1))
    user_msg = models.AssistantMessage(id=_new_id(), conversation_id=conv.id, role="user", content=body.content,
                                       file_ids=body.file_ids, charts=[], tool_calls=[], created_at=asked_at)
    reply = models.AssistantMessage(id=_new_id(), conversation_id=conv.id, role="assistant", content=result.text,
                                    charts=result.charts, file_ids=[], tool_calls=result.tool_calls,
                                    model=result.model, created_at=answered_at)
    db.add_all([user_msg, reply])
    if conv.title == "Новый диалог":
        conv.title = body.content.strip().splitlines()[0][:60]
    conv.updated_at = reply.created_at
    db.commit()
    return s.TurnOut(user_message=s.Message.model_validate(user_msg),
                     assistant_message=s.Message.model_validate(reply))
