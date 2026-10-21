"""Seed data demo.

Pemakaian (dari folder backend/):
    .venv\\Scripts\\python data/seed.py               # reset + seed, kebijakan kurir bila kosong
    .venv\\Scripts\\python data/seed.py --synthetic   # buat video uji bila data/samples/*.mp4 belum ada
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import init_db, session_scope
from app.services import demo_data


async def main(synthetic: bool) -> None:
    init_db()
    with session_scope() as db:
        report = demo_data.reset_and_seed(db, synthetic_media=synthetic)
        report["policies"] = await demo_data.ensure_policies(db)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synthetic", action="store_true", help="buat video uji bila sampel belum ada")
    asyncio.run(main(parser.parse_args().synthetic))
