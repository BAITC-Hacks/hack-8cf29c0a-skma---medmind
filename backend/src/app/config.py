from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", env_file_encoding="utf-8", extra="ignore",
    )

    data_dir: Path = Path("../../docs-hackalem/docs")
    database_url: str = "sqlite:///./var/hackalem.db"
    export_dir: Path = Path("./var/exports")
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # «Ленивый режим» — ИИ-ассистент (OpenAI Responses API). Без ключа ассистент выключен (503).
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model_fast: str = "gpt-6-luna"  # быстрые справки, дешёво
    openai_model: str = "gpt-6-sol"  # режим по умолчанию: анализ, инструменты, файлы
    openai_model_deep: str = "gpt-6-astra"  # глубокий разбор сложных вопросов
    assistant_max_tool_rounds: int = 8
    assistant_history_messages: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
