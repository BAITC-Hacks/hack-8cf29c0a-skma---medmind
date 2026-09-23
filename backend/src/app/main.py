from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import analytics, calc_runs, catalog, recommendations, settings
from app.config import get_settings
from app.db import init_db
from app.services.exporter import FILENAME_RE


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="HackAlem AI — заказы поставщикам",
    description="Расчёт рекомендованных заказов (Электрокомплект). Контракт: FRONTEND_TZ.md §0.3.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
for module in (recommendations, catalog, calc_runs, analytics, settings):
    api.include_router(module.router)


@api.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}


@api.get("/exports/{filename}", tags=["recommendations"])
def download_export(filename: str):
    path = get_settings().export_dir / filename
    if not FILENAME_RE.match(filename) or not path.is_file():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, filename=filename)


app.include_router(api)
