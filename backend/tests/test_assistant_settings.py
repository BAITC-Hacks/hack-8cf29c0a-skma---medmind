"""Saved credentials apply immediately and never appear in API responses."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.assistant import agent
from app.config import get_settings
from app.db import Base, get_db
from app.main import app


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(get_settings(), "openai_api_key", None)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    agent._openai_responses.cache_clear()
    try:
        with TestClient(app) as client:
            yield client, factory
    finally:
        app.dependency_overrides.pop(get_db)
        agent._openai_responses.cache_clear()
        engine.dispose()


def test_save_replace_delete_and_client_refresh(env, monkeypatch):
    client, factory = env
    constructed_keys = []

    def fake_openai(**kwargs):
        constructed_keys.append(kwargs["api_key"])
        return SimpleNamespace(responses=object())

    monkeypatch.setattr("openai.OpenAI", fake_openai)
    assert client.get("/api/settings/assistant").json() == {"configured": False, "source": None}
    for key in ["sk-test-first", "sk-test-replacement"]:
        result = client.put("/api/settings/assistant", json={"api_key": f"  {key}  "})
        assert result.status_code == 200
        assert result.json() == {"configured": True, "source": "settings"}
        assert key not in client.get("/api/settings/assistant").text
        assert client.get("/api/assistant/status").json()["enabled"] is True
        # New DB session, as on the next request or after restarting the application.
        with factory() as db:
            agent.get_client(db)
            agent.get_client(db)
    assert constructed_keys == ["sk-test-first", "sk-test-replacement"]
    assert client.delete("/api/settings/assistant").json() == {"configured": False, "source": None}
    assert client.get("/api/assistant/status").json()["enabled"] is False
    with factory() as db, pytest.raises(agent.AssistantDisabled):
        agent.get_client(db)


def test_environment_fallback(env, monkeypatch):
    client, factory = env
    monkeypatch.setattr(get_settings(), "openai_api_key", "sk-env-private")
    assert client.get("/api/settings/assistant").json() == {"configured": True, "source": "environment"}
    client.put("/api/settings/assistant", json={"api_key": "sk-ui-private"})
    from app.services.assistant_settings import api_key
    with factory() as db:
        assert api_key(db) == "sk-ui-private"
    result = client.delete("/api/settings/assistant")
    assert result.json() == {"configured": True, "source": "environment"}
    assert "sk-env-private" not in result.text
    with factory() as db:
        assert api_key(db) == "sk-env-private"


@pytest.mark.parametrize("key", ["", "  ", "sk-secret\ninvalid", "x" * 4097, "ключ"])
def test_invalid_key_does_not_overwrite_or_leak(env, key):
    client, factory = env
    client.put("/api/settings/assistant", json={"api_key": "sk-existing"})
    result = client.put("/api/settings/assistant", json={"api_key": key})
    assert result.status_code == 422
    assert set(result.json()) == {"detail"}
    assert "sk-secret" not in result.text
    from app.services.assistant_settings import api_key
    with factory() as db:
        assert api_key(db) == "sk-existing"
