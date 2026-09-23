from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["fast", "standard", "deep"]


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ModelInfo(BaseModel):
    mode: Mode
    model: str
    description: str


class AssistantStatus(BaseModel):
    enabled: bool
    reason: str | None = None
    default_mode: Mode = "standard"
    models: list[ModelInfo]


class ChartSeries(BaseModel):
    key: str
    name: str
    kind: Literal["actual", "forecast", "series"]


class Chart(BaseModel):
    """Спецификация кривой для Recharts: data — массив точек, series — какие ключи рисовать и как."""

    id: str
    type: Literal["line"]
    title: str
    subtitle: str | None = None
    x_key: str = "period"
    y_label: str
    series: list[ChartSeries]
    data: list[dict]


class ToolCall(BaseModel):
    name: str
    arguments: str


class Message(_Out):
    id: str
    role: Literal["user", "assistant"]
    content: str
    charts: list[Chart] = []
    file_ids: list[str] = []
    tool_calls: list[ToolCall] = []
    model: str | None = None
    created_at: datetime


class FileInfo(_Out):
    id: str
    filename: str
    size: int
    summary: dict
    created_at: datetime


class Conversation(_Out):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationDetail(Conversation):
    messages: list[Message]
    files: list[FileInfo]


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    file_ids: list[str] = Field(default_factory=list, max_length=10)
    mode: Mode = "standard"


class TurnOut(BaseModel):
    user_message: Message
    assistant_message: Message
