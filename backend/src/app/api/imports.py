from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.api.input_data import write_conflict
from app.db import get_db
from app.services.bundle_import import MAX_BUNDLE_BYTES, import_bundle

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/supplier-bundle/{supplier_id}")
def supplier_bundle(supplier_id: str, file: Annotated[UploadFile, File()], dry_run: bool = Form(True),
                    replace_supplier: bool = Form(False), db: Session = Depends(get_db)):
    """IEK/SE ZIP. Commit requires replace_supplier=true; replaces that supplier's inputs, including manual edits."""
    if not dry_run and not replace_supplier:
        raise HTTPException(422, "Для замены данных поставщика укажите replace_supplier=true")
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(415, "Требуется ZIP с Excel-отчётами поставщика")
    try:
        return import_bundle(db, file.file.read(MAX_BUNDLE_BYTES + 1), supplier_id, dry_run)
    except (IntegrityError, OperationalError) as exc:
        write_conflict(db, exc)
    finally:
        file.file.close()
