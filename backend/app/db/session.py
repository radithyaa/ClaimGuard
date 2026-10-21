from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, event
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

    Base.metadata.create_all(bind or engine)


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
