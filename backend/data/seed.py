"""Seed data demo.

Pemakaian (dari folder backend/):

    .venv\\Scripts\\python data/seed.py               # reset + seed, kebijakan kurir bila kosong
    .venv\\Scripts\\python data/seed.py --synthetic   # buat video uji bila data/samples/*.mp4 belum ada

Rekaman asli cukup ditaruh di `data/samples/` dengan nama yang sama seperti `file` di
`data/mock/shipments.json` (huruf besar/kecil dan ekstensi boleh berbeda). Periksa kesiapan
dan hitung `scanned_at` dengan `python -m app.tools.check_media`.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import init_db, session_scope
from app.services import seed_service


async def main(synthetic: bool) -> None:
    init_db()
    with session_scope() as db:
        report = await seed_service.seed_report(db, synthetic_media=synthetic)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synthetic", action="store_true", help="buat video uji bila sampel belum ada")
    asyncio.run(main(parser.parse_args().synthetic))
