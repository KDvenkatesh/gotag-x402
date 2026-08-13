from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from backend.config import DATABASE_URL
from backend.models import Base, Service, Vehicle

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    seed_demo_data()


def seed_demo_data() -> None:
    with SessionLocal() as session:
        existing_vehicle = session.execute(select(Vehicle).where(Vehicle.gotag_id == "GT-AP39-0001")).scalar_one_or_none()
        if existing_vehicle is None:
            session.add(
                Vehicle(
                    gotag_id="GT-AP39-0001",
                    plate_number="AP39XX1234",
                    owner_name="Venky",
                    owner_wallet="35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM",
                    vehicle_type="Car",
                    status="ACTIVE",
                    spending_limit=100_000_000,
                    spent_amount=0,
                )
            )

        for service_id, provider, service_type, price in [
            ("FUEL-001", "Fuel Station #01", "fuel", 10_000_000),
            ("TOLL-001", "Toll Gate #01", "toll", 500_000),
            ("EV-001", "Charger #17", "ev", 5_000_000),
            ("PARK-001", "Parking Zone A", "parking", 2_000_000),
        ]:
            existing_service = session.execute(select(Service).where(Service.service_id == service_id)).scalar_one_or_none()
            if existing_service is None:
                session.add(
                    Service(
                        service_id=service_id,
                        provider=provider,
                        service_type=service_type.upper(),
                        price_per_unit=price,
                        status="ACTIVE",
                    )
                )
        session.commit()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
