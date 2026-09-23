import os
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

# БД и папка экспорта — временные; переменные нужно выставить ДО импорта app.*
_tmp = Path(tempfile.mkdtemp(prefix="hackalem-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["EXPORT_DIR"] = str(_tmp / "exports")

AS_OF = date(2026, 9, 22)


def month_starts(n: int, end: date = date(2026, 8, 1)) -> list[date]:
    """n первых чисел месяцев, заканчивая end включительно."""
    out, y, m = [], end.year, end.month
    for _ in range(n):
        out.append(date(y, m, 1))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def steady_sales(sku: str, per_month: float, months: int = 20, lines_per_month: int = 10) -> list[dict]:
    """Равномерные отгрузки: lines_per_month строк в месяц на per_month штук суммарно."""
    rows = []
    for i, m in enumerate(month_starts(months)):
        for k in range(lines_per_month):
            rows.append({
                "sku_code": sku,
                "ts": datetime(m.year, m.month, 1) + timedelta(days=k * 2, hours=10),
                "document": f"{i:03d}{k:03d}",
                "doc_type": "Расходная накладная",
                "qty": per_month / lines_per_month,
            })
    return rows


@pytest.fixture(scope="session")
def tmp_dir() -> Path:
    return _tmp
