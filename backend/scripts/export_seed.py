"""Refresh the bundled seed from a local SQLite DB (read-only source).

Run from backend: uv run python scripts/export_seed.py var/hackalem.db
Review the snapshot before committing: it contains application data, not secrets from .env.
"""

import argparse
import base64
import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

from app.services.seed import SEED_DIR, SEED_MODELS


def export(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {
        "format_version": 1,
        "excluded_tables": ["sku_forecasts"],
        "tables": {},
    }
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")  # one consistent snapshot even when the app is running
        for model in SEED_MODELS:
            table = model.__table__
            columns = list(table.columns)
            order = ", ".join(f'"{col.name}"' for col in table.primary_key)
            path = destination / f"{table.name}.jsonl.gz"
            count = 0
            query = f'SELECT * FROM "{table.name}"'
            if table.name == "audit_log":
                query += " WHERE NOT (action = 'seed' AND entity = 'dataset')"
            with path.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as stream:
                for row in db.execute(query + f" ORDER BY {order}"):
                    record = dict(row)
                    for col in columns:
                        value = record[col.name]
                        if value is not None and str(col.type) == "JSON":
                            record[col.name] = json.loads(value)
                        elif isinstance(value, bytes):
                            record[col.name] = base64.b64encode(value).decode("ascii")
                    stream.write((json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"))
                    count += 1
            with path.open("rb") as stream:
                checksum = hashlib.file_digest(stream, "sha256").hexdigest()
            manifest["tables"][table.name] = {"rows": count, "sha256": checksum}
            print(f"{table.name}: {count}")
    fingerprint = hashlib.sha256(json.dumps(manifest["tables"], sort_keys=True).encode("utf-8")).hexdigest()
    manifest["dataset"] = f"demo-{fingerprint[:16]}"
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    export(args.source, SEED_DIR)
