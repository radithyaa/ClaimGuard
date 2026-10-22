from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            # WAL mencegah "database is locked" saat API, runner, dan scheduler menulis bersamaan
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return engine
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db(bind: Engine | None = None) -> None:
    import app.models  # noqa: F401  (mendaftarkan semua tabel)

    target = bind or engine
    Base.metadata.create_all(target)
    _add_missing_columns(target)
    _widen_columns(target)


# `create_all` tidak menambah kolom ke tabel yang sudah ada, sedangkan berkas SQLite demo dibuat
# sebelum kolom baru lahir. Tambahkan kolom hilang dengan ALTER TABLE yang idempoten.
_NEW_COLUMNS: dict[str, dict[str, str]] = {
    "shipments": {"resolution": "VARCHAR(16)", "resolution_reason": "TEXT"},
    "pack_scan_logs": {"packed_items_json": "JSON"},
}


def _add_missing_columns(bind: Engine) -> None:
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    for table, columns in _NEW_COLUMNS.items():
        if table not in existing_tables:
            continue
        present = {c["name"] for c in inspector.get_columns(table)}
        for name, ddl_type in columns.items():
            if name not in present:
                with bind.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl_type}"))


# Kolom yang sudah ada tetapi terlalu sempit (panjangnya ditentukan aplikasi, bukan data demo).
# SQLite mengabaikan batas panjang VARCHAR, Postgres menolak -> baris investigasi gagal disimpan.
_WIDEN_COLUMNS: dict[str, dict[str, int]] = {
    "investigations": {"verdict": 256},
}


def _widen_columns(bind: Engine) -> None:
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    dialect = bind.dialect.name
    for table, columns in _WIDEN_COLUMNS.items():
        if table not in existing_tables:
            continue
        present = {c["name"]: c for c in inspector.get_columns(table)}
        for name, width in columns.items():
            col = present.get(name)
            if col is None or getattr(col["type"], "length", None) is None:
                continue  # kolom belum ada (dibuat create_all) atau bertipe teks bebas
            if col["type"].length >= width:
                continue
            ddl_type = f"VARCHAR({width})"
            if dialect == "postgresql":
                stmt = f"ALTER TABLE {table} ALTER COLUMN {name} TYPE {ddl_type}"
            elif dialect == "sqlite":
                continue  # SQLite tidak menegakkan panjang VARCHAR; ubah tabel tidak sepadan risikonya
            else:
                stmt = f"ALTER TABLE {table} MODIFY {name} {ddl_type}"
            with bind.begin() as conn:
                conn.execute(text(stmt))


@contextmanager
def session_scope(factory: sessionmaker | None = None) -> Iterator[Session]:
    """Satu unit kerja: commit bila sukses, rollback bila error."""
    session = (factory or SessionLocal)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """Dependency FastAPI."""
    with session_scope() as session:
        yield session
