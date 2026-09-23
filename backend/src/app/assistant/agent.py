"""Агентный цикл «ленивого режима» поверх OpenAI Responses API.

Модель получает вопрос + историю диалога, вызывает инструменты (tools.py), пока не соберёт данные, и
отвечает текстом. Графики, построенные инструментами, прикладываются к ответу отдельно (charts).
store=false: история хранится у нас, в OpenAI не сохраняется.
"""

import logging
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Any, Literal, Protocol

from openai import APIConnectionError, APITimeoutError, AuthenticationError, PermissionDeniedError, RateLimitError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.assistant import tools
from app.config import get_settings
from app.services.assistant_settings import api_key

log = logging.getLogger(__name__)

Mode = Literal["fast", "standard", "deep"]
_REASONING: dict[str, str] = {"fast": "low", "standard": "low", "deep": "medium"}


class AssistantDisabled(RuntimeError):
    pass


class AssistantUpstreamError(RuntimeError):
    pass


def _upstream_message(exc: Exception, model: str) -> str:
    # Не возвращаем сырой текст SDK: в ошибке авторизации может оказаться часть ключа.
    if isinstance(exc, AuthenticationError):
        return "OpenAI отклонил API-ключ. Замените ключ в разделе «Настройки → ИИ-ассистент»."
    if isinstance(exc, PermissionDeniedError) or getattr(exc, "status_code", None) == 404:
        return f"Нет доступа к модели {model}. Проверьте модель и права API-ключа на сервере."
    if isinstance(exc, RateLimitError):
        return "OpenAI: превышен лимит запросов или исчерпана квота. Проверьте баланс и лимиты API."
    if isinstance(exc, APITimeoutError):
        return "Модель не успела ответить. Попробуйте ещё раз или выберите быстрый режим."
    if isinstance(exc, APIConnectionError):
        return "Сервер не смог подключиться к OpenAI. Попробуйте ещё раз позже."
    return f"Не удалось получить ответ модели {model}. Попробуйте ещё раз позже."


class ResponsesClient(Protocol):
    """Минимальный интерфейс клиента — в тестах подменяется фейком."""

    def create(self, **kwargs: Any) -> Any: ...


@lru_cache(maxsize=1)
def _openai_responses(key: str, base_url: str | None) -> ResponsesClient:
    from openai import OpenAI

    return OpenAI(api_key=key, base_url=base_url, max_retries=2, timeout=120).responses


def get_client(db: Session) -> ResponsesClient:
    key = api_key(db)
    if not key:
        raise AssistantDisabled("Добавьте API-ключ в разделе «Настройки → ИИ-ассистент» или задайте OPENAI_API_KEY на сервере.")
    return _openai_responses(key, get_settings().openai_base_url)


def model_for(mode: Mode) -> str:
    s = get_settings()
    return {"fast": s.openai_model_fast, "standard": s.openai_model, "deep": s.openai_model_deep}[mode]


def build_instructions(db: Session) -> str:
    suppliers = ", ".join(f"{s.name} (id={s.id}, срок поставки {s.lead_time_days} дн.)"
                          for s in db.scalars(select(models.Supplier)))
    categories = ", ".join(f"{c.name} (id={c.id})" for c in db.scalars(select(models.Category)))
    return f"""Ты — аналитик отдела закупок компании «Электрокомплект» в режиме «ленивый менеджер»: пользователь
задаёт вопросы обычным языком, ты сам находишь данные и объясняешь выводы. Сегодня {date.today():%d.%m.%Y}.

Данные: история отгрузок со склада «Алматы» из 1С, остатки, товар в пути, MOQ/кратность, расчёт системы
рекомендованных заказов (базовый спрос за 12 мес., исключение разовых оптовых отгрузок, компенсация
периодов без остатка, сезонность, тренд, страховой запас, MOQ). Поставщики: {suppliers or "нет данных"}.
Категории: {categories or "нет данных"}.

Правила:
- Любые цифры бери только из результатов инструментов. Не выдумывай данные; если их нет — так и скажи.
- Для общих вопросов начни с get_overview. Товар по названию ищи через search_skus, затем get_sku_details.
- Когда спрашивают про динамику, тренд, «как менялись продажи», прогноз — строй кривую (plot=true). Для
  сравнения нескольких товаров получи их данные и вызови plot_curve. График пользователь увидит под ответом —
  не перечисляй все точки текстом, опиши главное: рост/спад, пики, сезонность, чем кончится прогноз.
- Если пользователь приложил файл: analyze_file → forecast_from_file (plot=true, если просят прогноз
  или динамику). Объясняй, что прогноз построен по данным файла и какие разовые отгрузки исключены.
- Объясняй «почему» простыми словами: из чего сложилась цифра заказа (спрос, сезонность, остаток, в пути,
  буфер, округление по MOQ).
- Ты ничего не меняешь и не отправляешь: утверждение заказа — только вручную в интерфейсе, автоотправки
  поставщику нет. Рядом с каждым упомянутым товаром с рекомендацией добавляй Markdown-ссылку
  [Открыть заказ и утвердить](order_url), подставляя точный order_url из инструмента. Для уже утверждённых
  позиций подпись — [Открыть заказ](order_url). Ссылка открывает карточку с количеством и кнопкой утверждения.
  Если ссылки нет, получи её через search_skus или get_sku_details; не придумывай URL или ID.
  Для товаров только из загруженного файла без рекомендации ссылку не добавляй.
- Отвечай по-русски, кратко и по делу: 3–8 предложений или короткий список. Коды товаров указывай как
  «030200192_». Числа форматируй с пробелом между разрядами, единицы — как в данных (шт, м, упак).
"""


@dataclass
class TurnResult:
    text: str
    charts: list[dict]
    tool_calls: list[dict]
    model: str


def _history(db: Session, conversation_id: str, limit: int) -> list[dict]:
    msgs = db.scalars(
        select(models.AssistantMessage).where(models.AssistantMessage.conversation_id == conversation_id)
        .order_by(models.AssistantMessage.created_at.desc()).limit(limit)
    ).all()
    return [{"role": m.role, "content": _user_content(db, m.content, m.file_ids or [])
             if m.role == "user" else m.content} for m in reversed(msgs)]


def _user_content(db: Session, text: str, file_ids: list[str]) -> str:
    if not file_ids:
        return text
    files = db.scalars(select(models.AssistantFile).where(models.AssistantFile.id.in_(file_ids))).all()
    lines = [f"- file_id={f.id}: {f.filename} ({f.summary.get('kind_label', '')}, "
             f"{f.summary.get('period_from')}…{f.summary.get('period_to')}, товаров: {f.summary.get('skus')})"
             for f in files]
    return f"{text}\n\n[Приложенные файлы]\n" + "\n".join(lines)


def run_turn(db: Session, conversation_id: str, text: str, file_ids: list[str], mode: Mode,
             client: ResponsesClient | None = None) -> TurnResult:
    """Один ход диалога: история + новый вопрос → ответ модели (с вызовами инструментов)."""
    s = get_settings()
    client = client or get_client(db)
    model = model_for(mode)
    ctx = tools.ToolContext(db=db, conversation_id=conversation_id)
    items: list[Any] = _history(db, conversation_id, s.assistant_history_messages)
    items.append({"role": "user", "content": _user_content(db, text, file_ids)})
    base_kwargs = {
        "model": model,
        "instructions": build_instructions(db),
        "tools": [t.spec() for t in tools.TOOLS],
        "reasoning": {"effort": _REASONING[mode]},
        "store": False,
        "include": ["reasoning.encrypted_content"],  # нужно, чтобы вернуть reasoning-элементы при store=false
    }
    calls_log: list[dict] = []

    for round_ in range(s.assistant_max_tool_rounds + 1):
        kwargs = dict(base_kwargs, input=items)
        if round_ == s.assistant_max_tool_rounds:
            kwargs["tool_choice"] = "none"  # лимит вызовов исчерпан — пусть отвечает тем, что собрал
        try:
            response = client.create(**kwargs)
        except Exception as exc:  # openai.APIError и сетевые ошибки
            log.warning("OpenAI request failed: model=%s type=%s status=%s", model,
                        type(exc).__name__, getattr(exc, "status_code", None))
            raise AssistantUpstreamError(_upstream_message(exc, model)) from exc

        if getattr(response, "status", None) in {"failed", "incomplete", "cancelled"}:
            raise AssistantUpstreamError("Модель не завершила ответ. Попробуйте ещё раз или уточните вопрос.")
        calls = [o for o in response.output if getattr(o, "type", None) == "function_call"]
        if not calls:
            answer = (response.output_text or "").strip()
            if not answer:
                raise AssistantUpstreamError("Модель не завершила ответ. Попробуйте ещё раз или уточните вопрос.")
            return TurnResult(text=answer, charts=ctx.charts,
                              tool_calls=calls_log, model=model)
        items.extend(response.output)
        for call in calls:
            output = tools.execute(ctx, call.name, call.arguments)
            calls_log.append({"name": call.name, "arguments": call.arguments})
            items.append({"type": "function_call_output", "call_id": call.call_id, "output": output})

    raise AssistantUpstreamError("Не удалось получить ответ за отведённое число шагов — уточните вопрос.")
