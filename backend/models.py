from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Vehicle(Base):
    __tablename__ = "vehicles"

    gotag_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    plate_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    owner_wallet: Mapped[str] = mapped_column(String(128), nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(64), default="Car")
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    spending_limit: Mapped[int] = mapped_column(Integer, default=100_000_000)
    spent_amount: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)


class Service(Base):
    __tablename__ = "services"

    service_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    provider: Mapped[str] = mapped_column(String(120), nullable=False)
    service_type: Mapped[str] = mapped_column(String(32), nullable=False)
    price_per_unit: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True, index=True)
    gotag_id: Mapped[str] = mapped_column(String(64), index=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    payment_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)


class TollJourney(Base):
    __tablename__ = "toll_journeys"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True, index=True)
    gotag_id: Mapped[str] = mapped_column(String(64), index=True)
    entry_point: Mapped[str] = mapped_column(String(64), nullable=False)
    exit_point: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="OPEN")  # OPEN, COMPLETED, FREE_RETURN, PAYMENT_PENDING, PAID
    payment_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    algorand_tx_id: Mapped[str | None] = mapped_column(String(128), nullable=True)


class ParkingSession(Base):
    __tablename__ = "parking_sessions"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True, index=True)
    gotag_id: Mapped[str] = mapped_column(String(64), index=True)
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    billable_hours: Mapped[int] = mapped_column(Integer, default=0)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="PARKED")  # PARKED, COMPLETED, PARKING_FREE, PAYMENT_PENDING, PAID
    payment_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    algorand_tx_id: Mapped[str | None] = mapped_column(String(128), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    transaction_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, index=True)
    session_id: Mapped[str] = mapped_column(String(128), index=True)
    gotag_id: Mapped[str] = mapped_column(String(64), index=True)
    service_type: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    payment_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="PAID")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=lambda: datetime.now(timezone.utc))
    algorand_tx_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

