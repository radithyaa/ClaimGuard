"""Tulis kontrak API ke backend/openapi.json (sumber `openapi-typescript` di frontend).

    .venv\\Scripts\\python scripts/export_openapi.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import app

out = ROOT / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{out} ({len(app.openapi()['paths'])} path)")
