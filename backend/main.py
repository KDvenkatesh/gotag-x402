from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.config import (
    DEMO_MODE,
    FRONTEND_URL,
    GOTAG_APP_ID,
    GOTAG_PAYMENT_ASSET_ID,
    SETTLEMENT_AUTHORITY,
)
from backend.database import get_db_session, init_db
from backend.models import ParkingSession, Service, TollJourney, Transaction, Vehicle
from backend.models import Session as SessionModel
from backend.services.algorand_service import (
    build_demo_service,
    build_demo_vehicle,
    create_session_onchain,
    record_payment_onchain,
    register_service_onchain,
    register_vehicle_onchain,
)
from backend.services.x402_service import (
    create_payment_request,
    settle_payment,
    verify_payment,
)

app = FastAPI(title="GoTag API", version="1.0.0")
origins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]
if FRONTEND_URL and FRONTEND_URL not in origins:
    origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if FRONTEND_URL == "*" else origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Type", "Authorization"],
)

init_db()

# ---------------------------------------------------------------------------
# MACHINE PRICING CONSTANTS (authoritative — never from frontend)
# ---------------------------------------------------------------------------

# 1 GTUSD = 1_000_000 base units (6 decimal places)
FUEL_PRICE_PER_LITRE_MICROS: int = 2_000_000   # 2.00 GTUSD / litre
EV_PRICE_PER_KWH_MICROS: int = 250_000          # 0.25 GTUSD / kWh
TOLL_FREE_RETURN_MINUTES: int = 30
TOLL_RATES_MICROS: dict[str, int] = {
    "Car": 8_000_000,        # 8.00 GTUSD
    "SUV": 15_000_000,       # 15.00 GTUSD
    "Motorcycle": 3_000_000, # 3.00 GTUSD
    "Truck": 20_000_000,     # 20.00 GTUSD
}
DEFAULT_TOLL_RATE_MICROS: int = 8_000_000

PARKING_RATE_PER_HOUR_MICROS: int = 500_000  # 0.50 GTUSD / hour
PARKING_GRACE_MINUTES: int = 15

ALLOWED_SERVICE_IDS: set[str] = {
    "FUEL-001", "EV-001", "TOLL-001", "PARK-001",
}

logger = logging.getLogger("backend.main")


class VehicleRegisterRequest(BaseModel):
    plate_number: str = Field(..., min_length=3, max_length=32)
    owner_name: str = Field(..., min_length=2, max_length=120)
    owner_wallet: str = Field(..., min_length=10, max_length=128)
    vehicle_type: str = Field(default="Car", min_length=2, max_length=64)
    spending_limit: int = Field(default=100_000_000, gt=0)


class ServiceRegisterRequest(BaseModel):
    service_id: str = Field(..., min_length=2, max_length=64)
    provider: str = Field(..., min_length=2, max_length=120)
    service_type: str = Field(..., min_length=2, max_length=32)
    price_per_unit: int = Field(..., gt=0)


class SessionRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    service_id: str = Field(..., min_length=2, max_length=64)
    amount: int = Field(..., gt=0)
    payment_ref: str | None = None


class PaymentRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    service_id: str = Field(..., min_length=2, max_length=64)
    # amount is accepted for schema compatibility but is OVERRIDDEN by the
    # backend when a usage object is present.  Default 1 avoids validator
    # errors when the client omits it.
    amount: int = Field(default=1, gt=0)
    payment_data: dict[str, Any] | None = None
    # Optional machine usage payload — backend re-derives amount from this.
    usage: dict[str, Any] | None = None

    model_config = {"extra": "allow"}


class FuelUsageRequest(BaseModel):
    """Report from the fuel dispenser machine."""
    gotag_id: str = Field(..., min_length=3, max_length=64)
    service_id: str = Field(default="FUEL-001")
    fuel_type: str = Field(default="PETROL")
    quantity: float = Field(..., gt=0, description="Litres dispensed")
    unit: str = Field(default="L")


class EvUsageRequest(BaseModel):
    """Report from the EV charging machine."""
    gotag_id: str = Field(..., min_length=3, max_length=64)
    service_id: str = Field(default="EV-001")
    energy: float = Field(..., gt=0, description="kWh consumed")
    unit: str = Field(default="kWh")


class TollEntryRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    toll_point_id: str = Field(default="TOLL-X-ENTRY")


class TollExitRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    toll_point_id: str = Field(default="TOLL-Y-EXIT")


class ParkingEntryRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    location_id: str = Field(default="PARK-001")


class ParkingExitRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    location_id: str = Field(default="PARK-001")


class TopUpRequest(BaseModel):
    gotag_id: str = Field(..., min_length=3, max_length=64)
    amount: int = Field(..., gt=0, description="Top-up amount in micro GTUSD")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "demo_mode": DEMO_MODE, "network": "Algorand TestNet"}


@app.post("/api/wallet/topup")
def wallet_topup(
    payload: TopUpRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    vehicle.spending_limit += payload.amount
    db.commit()

    tx_id = f"TOPUP-{uuid.uuid4().hex[:12].upper()}"
    session_id = f"TOPUP-{uuid.uuid4().hex[:8].upper()}"

    tx = Transaction(
        session_id=session_id,
        gotag_id=payload.gotag_id,
        service_type="TOPUP",
        amount=payload.amount,
        payment_ref=tx_id,
        status="CONFIRMED",
        algorand_tx_id=tx_id,
    )
    db.add(tx)
    db.commit()

    new_balance = max(vehicle.spending_limit - vehicle.spent_amount, 0)

    return {
        "success": True,
        "session_id": session_id,
        "gotag_id": payload.gotag_id,
        "amount": payload.amount,
        "amount_gtusd": payload.amount / 1_000_000,
        "new_spending_limit": vehicle.spending_limit,
        "available_balance": new_balance,
        "payment_ref": tx_id,
        "algorand_tx_id": tx_id,
        "status": "CONFIRMED",
        "asset_id": GOTAG_PAYMENT_ASSET_ID,
        "network": "Algorand TestNet",
        "message": f"TestNet GTUSD Top-Up of {payload.amount / 1_000_000:.2f} GTUSD successful.",
    }


@app.get("/api/payment-config")
def payment_config() -> dict[str, Any]:
    return {
        "app_id": GOTAG_APP_ID,
        "payment_asset_id": GOTAG_PAYMENT_ASSET_ID,
        "settlement_authority": SETTLEMENT_AUTHORITY,
        "network": "Algorand TestNet",
    }


@app.get("/api/vehicles/{gotag_id}")
def get_vehicle(gotag_id: str, db: Session = Depends(get_db_session)) -> dict[str, Any]:
    clean_id = gotag_id.strip()
    vehicle = db.get(Vehicle, clean_id)
    if not vehicle:
        vehicle = db.execute(
            select(Vehicle).where(func.upper(Vehicle.gotag_id) == clean_id.upper())
        ).scalar_one_or_none()
    if not vehicle:
        raise HTTPException(
            status_code=404,
            detail=f'GoTag "{clean_id}" not found in system. Please register this vehicle first.',
        )
    return {
        "gotag_id": vehicle.gotag_id,
        "plate_number": vehicle.plate_number,
        "owner_name": vehicle.owner_name,
        "owner_wallet": vehicle.owner_wallet,
        "vehicle_type": vehicle.vehicle_type,
        "status": vehicle.status,
        "spending_limit": vehicle.spending_limit,
        "available_balance": max(vehicle.spending_limit - vehicle.spent_amount, 0),
    }


@app.get("/api/vehicles/by-plate/{plate}")
def get_vehicle_by_plate(
    plate: str, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    vehicle = db.execute(
        select(Vehicle).where(Vehicle.plate_number == plate.upper())
    ).scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {
        "gotag_id": vehicle.gotag_id,
        "plate_number": vehicle.plate_number,
        "status": vehicle.status,
        "owner_name": vehicle.owner_name,
        "spending_limit": vehicle.spending_limit,
        "available_balance": max(vehicle.spending_limit - vehicle.spent_amount, 0),
    }


@app.get("/api/vehicles/by-wallet/{wallet_address}")
def get_vehicles_by_wallet(
    wallet_address: str, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    wallet_clean = wallet_address.strip()
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_wallet == wallet_clean)
    ).scalars().all()

    if not vehicles:
        return {
            "registered": False,
            "wallet_address": wallet_clean,
            "vehicles": [],
            "primary_vehicle": None,
        }

    vehicles_data = [
        {
            "gotag_id": v.gotag_id,
            "plate_number": v.plate_number,
            "owner_name": v.owner_name,
            "owner_wallet": v.owner_wallet,
            "vehicle_type": v.vehicle_type,
            "status": v.status,
            "spending_limit": v.spending_limit,
            "available_balance": max(v.spending_limit - v.spent_amount, 0),
        }
        for v in vehicles
    ]

    return {
        "registered": True,
        "wallet_address": wallet_clean,
        "vehicles": vehicles_data,
        "primary_vehicle": vehicles_data[0],
    }


@app.get("/api/services")
def list_services(db: Session = Depends(get_db_session)) -> list[dict[str, Any]]:
    services = db.execute(select(Service)).scalars().all()
    return [
        {
            "service_id": service.service_id,
            "provider": service.provider,
            "service_type": service.service_type,
            "price_per_unit": service.price_per_unit,
            "status": service.status,
        }
        for service in services
    ]


@app.post("/api/vehicles/register")
def register_vehicle(
    payload: VehicleRegisterRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    existing = db.execute(
        select(Vehicle).where(Vehicle.plate_number == payload.plate_number.upper())
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Vehicle plate already exists")
    gotag_id = f"GT-{payload.plate_number[:4].upper()}-{str(uuid.uuid4().int % 10_000).zfill(4)}"
    vehicle = build_demo_vehicle(
        payload.plate_number,
        payload.owner_name,
        payload.owner_wallet,
        payload.vehicle_type,
    )
    vehicle.gotag_id = gotag_id
    vehicle.spending_limit = payload.spending_limit
    vehicle.status = "ACTIVE"
    db.add(vehicle)
    db.commit()
    register_vehicle_onchain(
        gotag_id, payload.plate_number, payload.owner_wallet, payload.spending_limit
    )
    return {
        "success": True,
        "gotag_id": gotag_id,
        "plate_number": payload.plate_number.upper(),
        "owner_name": payload.owner_name,
        "status": "ACTIVE",
        "spending_limit": payload.spending_limit,
        "qr_code": gotag_id,
    }


@app.get("/api/admin/vehicles")
def admin_vehicles(db: Session = Depends(get_db_session)) -> list[dict[str, Any]]:
    vehicles = db.execute(select(Vehicle)).scalars().all()
    return [
        {
            "gotag_id": vehicle.gotag_id,
            "plate_number": vehicle.plate_number,
            "owner_name": vehicle.owner_name,
            "owner_wallet": vehicle.owner_wallet,
            "vehicle_type": vehicle.vehicle_type,
            "status": vehicle.status,
            "spending_limit": vehicle.spending_limit,
            "spent_amount": vehicle.spent_amount,
        }
        for vehicle in vehicles
    ]


@app.post("/api/admin/vehicles/{gotag_id}/block")
def block_vehicle_admin(
    gotag_id: str, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle.status = "BLOCKED"
    db.commit()
    return {"success": True, "gotag_id": gotag_id, "status": "BLOCKED"}


@app.post("/api/admin/vehicles/{gotag_id}/unblock")
def unblock_vehicle_admin(
    gotag_id: str, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle.status = "ACTIVE"
    db.commit()
    return {"success": True, "gotag_id": gotag_id, "status": "ACTIVE"}


@app.post("/api/services/register")
def register_service(
    payload: ServiceRegisterRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    service = build_demo_service(
        payload.service_id,
        payload.provider,
        payload.service_type,
        payload.price_per_unit,
    )
    existing = db.get(Service, payload.service_id)
    if existing:
        raise HTTPException(status_code=409, detail="Service ID already exists")
    db.add(service)
    db.commit()
    register_service_onchain(
        payload.service_id,
        payload.provider,
        payload.service_type,
        payload.price_per_unit,
    )
    return {"success": True, "service": service.service_id, "status": "ACTIVE"}


@app.post("/api/sessions")
def create_session(
    payload: SessionRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="Vehicle is blocked")
    service = db.get(Service, payload.service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    if vehicle.spending_limit < vehicle.spent_amount + payload.amount:
        raise HTTPException(status_code=400, detail="Spending limit exceeded.")
    session_id = f"SESSION-{uuid.uuid4().hex[:8].upper()}"
    session = SessionModel(
        session_id=session_id,
        gotag_id=payload.gotag_id,
        service_id=payload.service_id,
        amount=payload.amount,
        status="PENDING",
        payment_ref=payload.payment_ref,
    )
    db.add(session)
    db.commit()
    create_session_onchain(
        session_id, payload.gotag_id, payload.service_id, payload.amount
    )
    return {
        "success": True,
        "session_id": session_id,
        "status": "PENDING",
        "amount": payload.amount,
    }


@app.get("/api/sessions/{session_id}")
def get_session(
    session_id: str, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session.session_id,
        "gotag_id": session.gotag_id,
        "service_id": session.service_id,
        "amount": session.amount,
        "status": session.status,
        "payment_ref": session.payment_ref,
    }


@app.post("/api/sessions/{session_id}/pay")
def pay_session(
    session_id: str, payload: dict[str, Any], db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    payment_ref = payload.get("payment_ref") or f"X402-{uuid.uuid4().hex[:12].upper()}"
    if not payload.get("payment_data"):
        # Log which top-level fields were present (safe, no secrets)
        logger.warning(
            "Missing payment_data in pay_session request",
            extra={
                "session_id": session_id,
                "present_fields": list(payload.keys()),
            },
        )
        raise HTTPException(
            status_code=400, detail="Payment transaction details are required"
        )
    payment_data = payload.get("payment_data")
    if not verify_payment(payment_ref, payment_data):
        raise HTTPException(status_code=402, detail="Payment verification failed")
    status_result = settle_payment(payment_ref, payment_data)
    session.status = status_result["status"]
    session.payment_ref = payment_ref
    db.commit()
    vehicle = db.get(Vehicle, session.gotag_id)
    if vehicle:
        vehicle.spent_amount += session.amount
    tx = Transaction(
        session_id=session_id,
        gotag_id=session.gotag_id,
        service_type=(
            db.get(Service, session.service_id).service_type
            if db.get(Service, session.service_id)
            else "FUEL"
        ),
        amount=session.amount,
        payment_ref=payment_ref,
        status="PAID",
        algorand_tx_id=status_result.get("payment_ref"),
    )
    db.add(tx)
    db.commit()
    record_payment_onchain(session_id, payment_ref)
    return {
        "success": True,
        "session_id": session_id,
        "status": "PAID",
        "payment_ref": payment_ref,
    }


@app.post("/api/sessions/{session_id}/cancel")
def cancel_session(
    session_id: str, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.status = "CANCELLED"
    db.commit()
    return {"success": True, "session_id": session_id, "status": "CANCELLED"}


@app.get("/api/transactions")
def list_transactions(
    wallet_address: str | None = None,
    db: Session = Depends(get_db_session),
) -> list[dict[str, Any]]:
    query = select(Transaction).order_by(Transaction.transaction_id.desc())

    if wallet_address:
        wallet_clean = wallet_address.strip()
        owned_ids = db.execute(
            select(Vehicle.gotag_id).where(Vehicle.owner_wallet == wallet_clean)
        ).scalars().all()

        query = query.where(
            (Transaction.gotag_id.in_(owned_ids)) |
            (Transaction.payment_ref.like(f"%{wallet_clean}%"))
        )

    txs = db.execute(query).scalars().all()
    return [
        {
            "transaction_id": tx.transaction_id,
            "session_id": tx.session_id,
            "gotag_id": tx.gotag_id,
            "service_type": tx.service_type,
            "amount": tx.amount,
            "payment_ref": tx.payment_ref,
            "status": tx.status,
            "timestamp": tx.timestamp.isoformat(),
            "algorand_tx_id": tx.algorand_tx_id,
        }
        for tx in txs
    ]


# ---------------------------------------------------------------------------
# MACHINE USAGE ENDPOINTS  (backend is authoritative for pricing)
# ---------------------------------------------------------------------------


@app.post("/api/services/fuel/usage")
def fuel_usage(
    payload: FuelUsageRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    """Fuel dispenser reports litres → backend calculates GTUSD."""
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    amount_micros = int(round(payload.quantity * FUEL_PRICE_PER_LITRE_MICROS))
    unit_price_gtusd = FUEL_PRICE_PER_LITRE_MICROS / 1_000_000
    total_gtusd = amount_micros / 1_000_000

    return {
        "gotag_id": payload.gotag_id,
        "service_id": payload.service_id,
        "fuel_type": payload.fuel_type,
        "quantity": payload.quantity,
        "unit": payload.unit,
        "unit_price_gtusd": unit_price_gtusd,
        "total_gtusd": total_gtusd,
        "amount_micros": amount_micros,
        "currency": "GTUSD",
        "asset_id": GOTAG_PAYMENT_ASSET_ID,
        "network": "Algorand TestNet",
        "message": f"{payload.quantity} {payload.unit} × {unit_price_gtusd} GTUSD = {total_gtusd} GTUSD",
    }


@app.post("/api/services/ev/usage")
def ev_usage(
    payload: EvUsageRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    """EV charger reports kWh → backend calculates GTUSD."""
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    amount_micros = int(round(payload.energy * EV_PRICE_PER_KWH_MICROS))
    unit_price_gtusd = EV_PRICE_PER_KWH_MICROS / 1_000_000
    total_gtusd = amount_micros / 1_000_000

    return {
        "gotag_id": payload.gotag_id,
        "service_id": payload.service_id,
        "energy": payload.energy,
        "unit": payload.unit,
        "unit_price_gtusd": unit_price_gtusd,
        "total_gtusd": total_gtusd,
        "amount_micros": amount_micros,
        "currency": "GTUSD",
        "asset_id": GOTAG_PAYMENT_ASSET_ID,
        "network": "Algorand TestNet",
        "message": f"{payload.energy} {payload.unit} × {unit_price_gtusd} GTUSD = {total_gtusd} GTUSD",
    }


@app.post("/api/services/fuel/usage")
def fuel_usage(
    payload: FuelUsageRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    """Fuel dispenser reports litres → backend calculates GTUSD."""
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    amount_micros = int(round(payload.quantity * FUEL_PRICE_PER_LITRE_MICROS))
    unit_price_gtusd = FUEL_PRICE_PER_LITRE_MICROS / 1_000_000
    total_gtusd = amount_micros / 1_000_000

    return {
        "gotag_id": payload.gotag_id,
        "service_id": payload.service_id,
        "fuel_type": payload.fuel_type,
        "quantity": payload.quantity,
        "unit": payload.unit,
        "unit_price_gtusd": unit_price_gtusd,
        "total_gtusd": total_gtusd,
        "amount_micros": amount_micros,
        "currency": "GTUSD",
        "asset_id": GOTAG_PAYMENT_ASSET_ID,
        "network": "Algorand TestNet",
        "message": f"{payload.quantity} {payload.unit} × {unit_price_gtusd} GTUSD = {total_gtusd} GTUSD",
    }


@app.post("/api/services/ev/usage")
def ev_usage(
    payload: EvUsageRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    """EV charger reports kWh → backend calculates GTUSD."""
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    amount_micros = int(round(payload.energy * EV_PRICE_PER_KWH_MICROS))
    unit_price_gtusd = EV_PRICE_PER_KWH_MICROS / 1_000_000
    total_gtusd = amount_micros / 1_000_000

    return {
        "gotag_id": payload.gotag_id,
        "service_id": payload.service_id,
        "energy": payload.energy,
        "unit": payload.unit,
        "unit_price_gtusd": unit_price_gtusd,
        "total_gtusd": total_gtusd,
        "amount_micros": amount_micros,
        "currency": "GTUSD",
        "asset_id": GOTAG_PAYMENT_ASSET_ID,
        "network": "Algorand TestNet",
        "message": f"{payload.energy} {payload.unit} × {unit_price_gtusd} GTUSD = {total_gtusd} GTUSD",
    }


# ---------------------------------------------------------------------------
# TOLL SERVICE ENDPOINTS (FASTag-style entry / exit)
# ---------------------------------------------------------------------------


@app.post("/api/services/toll/entry")
def toll_entry(
    payload: TollEntryRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    # Check for existing open journey
    existing = db.execute(
        select(TollJourney)
        .where(TollJourney.gotag_id == payload.gotag_id)
        .where(TollJourney.status == "OPEN")
    ).scalar_one_or_none()

    if existing:
        return {
            "success": True,
            "status": "JOURNEY_STARTED",
            "session_id": existing.session_id,
            "gotag_id": existing.gotag_id,
            "entry_point": existing.entry_point,
            "entry_time": existing.entry_time.isoformat(),
            "message": "Toll journey already active.",
        }

    session_id = f"TOLL-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.utcnow()
    journey = TollJourney(
        session_id=session_id,
        gotag_id=payload.gotag_id,
        entry_point=payload.toll_point_id,
        entry_time=now,
        status="OPEN",
    )
    db.add(journey)
    db.commit()

    return {
        "success": True,
        "status": "JOURNEY_STARTED",
        "session_id": session_id,
        "gotag_id": payload.gotag_id,
        "entry_point": payload.toll_point_id,
        "entry_time": now.isoformat(),
        "message": "Toll journey started. Drive safe!",
    }


@app.post("/api/services/toll/exit")
def toll_exit(
    payload: TollExitRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    # Check if duplicate exit on already completed/paid/free journey
    completed = db.execute(
        select(TollJourney)
        .where(TollJourney.gotag_id == payload.gotag_id)
        .where(TollJourney.status.in_(["FREE_RETURN", "PAID"]))
        .order_by(TollJourney.entry_time.desc())
    ).scalars().first()

    # Find active open or pending journey
    journey = db.execute(
        select(TollJourney)
        .where(TollJourney.gotag_id == payload.gotag_id)
        .where(TollJourney.status.in_(["OPEN", "PAYMENT_PENDING"]))
        .order_by(TollJourney.entry_time.desc())
    ).scalars().first()

    if not journey:
        if completed:
            return {
                "success": True,
                "status": completed.status,
                "session_id": completed.session_id,
                "amount": completed.amount,
                "reason": "Toll exit already processed.",
            }
        raise HTTPException(status_code=404, detail="No active toll journey found for vehicle")

    now = datetime.utcnow()
    elapsed_minutes = (now - journey.entry_time).total_seconds() / 60.0

    # 30-minute Free Return Window Check
    if elapsed_minutes <= TOLL_FREE_RETURN_MINUTES:
        journey.status = "FREE_RETURN"
        journey.exit_point = payload.toll_point_id
        journey.exit_time = now
        journey.amount = 0
        db.commit()

        # Add 0 amount transaction record
        tx = Transaction(
            session_id=journey.session_id,
            gotag_id=payload.gotag_id,
            service_type="TOLL",
            amount=0,
            payment_ref="FREE_RETURN",
            status="PAID",
            algorand_tx_id=None,
        )
        db.add(tx)
        db.commit()

        return {
            "success": True,
            "status": "FREE_RETURN",
            "session_id": journey.session_id,
            "gotag_id": payload.gotag_id,
            "entry_point": journey.entry_point,
            "exit_point": payload.toll_point_id,
            "elapsed_minutes": round(elapsed_minutes, 1),
            "amount": 0,
            "reason": f"Returned within {TOLL_FREE_RETURN_MINUTES}-minute free window",
            "barrier_open": True,
        }

    # Outside free window — calculate rate based on vehicle category
    v_type = vehicle.vehicle_type or "Car"
    toll_rate_micros = TOLL_RATES_MICROS.get(v_type, DEFAULT_TOLL_RATE_MICROS)
    journey.status = "PAYMENT_PENDING"
    journey.exit_point = payload.toll_point_id
    journey.exit_time = now
    journey.amount = toll_rate_micros
    db.commit()

    req = create_payment_request(
        payload.gotag_id,
        "TOLL-001",
        toll_rate_micros,
        f"Toll Gate ({journey.entry_point} → {payload.toll_point_id})",
        usage={
            "entry_point": journey.entry_point,
            "exit_point": payload.toll_point_id,
            "vehicle_type": v_type,
            "elapsed_minutes": round(elapsed_minutes, 1),
            "amount_gtusd": toll_rate_micros / 1_000_000,
        },
    )
    req["session_id"] = journey.session_id
    return JSONResponse(status_code=402, content=req)


# ---------------------------------------------------------------------------
# PARKING SERVICE ENDPOINTS (Time-based with Grace Period)
# ---------------------------------------------------------------------------


@app.post("/api/services/parking/entry")
def parking_entry(
    payload: ParkingEntryRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    existing = db.execute(
        select(ParkingSession)
        .where(ParkingSession.gotag_id == payload.gotag_id)
        .where(ParkingSession.status == "PARKED")
    ).scalar_one_or_none()

    if existing:
        return {
            "success": True,
            "status": "PARKED",
            "session_id": existing.session_id,
            "gotag_id": existing.gotag_id,
            "entry_time": existing.entry_time.isoformat(),
            "rate_per_hour_gtusd": PARKING_RATE_PER_HOUR_MICROS / 1_000_000,
            "message": "Parking session active.",
        }

    session_id = f"PARK-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.utcnow()
    p_session = ParkingSession(
        session_id=session_id,
        gotag_id=payload.gotag_id,
        entry_time=now,
        status="PARKED",
    )
    db.add(p_session)
    db.commit()

    return {
        "success": True,
        "status": "PARKED",
        "session_id": session_id,
        "gotag_id": payload.gotag_id,
        "entry_time": now.isoformat(),
        "rate_per_hour_gtusd": PARKING_RATE_PER_HOUR_MICROS / 1_000_000,
        "message": "Parking session started.",
    }


@app.get("/api/services/parking/active/{gotag_id}")
def parking_active(
    gotag_id: str,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    p_session = db.execute(
        select(ParkingSession)
        .where(ParkingSession.gotag_id == gotag_id)
        .where(ParkingSession.status == "PARKED")
    ).scalar_one_or_none()

    if not p_session:
        return {"active": False}

    now = datetime.utcnow()
    elapsed_seconds = int((now - p_session.entry_time).total_seconds())

    return {
        "active": True,
        "session_id": p_session.session_id,
        "gotag_id": p_session.gotag_id,
        "entry_time": p_session.entry_time.isoformat(),
        "elapsed_seconds": elapsed_seconds,
        "rate_per_hour_gtusd": PARKING_RATE_PER_HOUR_MICROS / 1_000_000,
        "grace_minutes": PARKING_GRACE_MINUTES,
    }


@app.post("/api/services/parking/exit")
def parking_exit(
    payload: ParkingExitRequest,
    db: Session = Depends(get_db_session),
) -> dict[str, Any]:
    vehicle = db.get(Vehicle, payload.gotag_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="GoTag is blocked")

    completed = db.execute(
        select(ParkingSession)
        .where(ParkingSession.gotag_id == payload.gotag_id)
        .where(ParkingSession.status.in_(["PARKING_FREE", "PAID"]))
        .order_by(ParkingSession.entry_time.desc())
    ).scalars().first()

    p_session = db.execute(
        select(ParkingSession)
        .where(ParkingSession.gotag_id == payload.gotag_id)
        .where(ParkingSession.status.in_(["PARKED", "PAYMENT_PENDING"]))
        .order_by(ParkingSession.entry_time.desc())
    ).scalars().first()

    if not p_session:
        if completed:
            return {
                "success": True,
                "status": completed.status,
                "session_id": completed.session_id,
                "amount": completed.amount,
                "reason": "Parking session already closed.",
            }
        raise HTTPException(status_code=404, detail="No active parking session found for vehicle")

    now = datetime.utcnow()
    duration_minutes = max(1, int(round((now - p_session.entry_time).total_seconds() / 60.0)))

    # 15-minute Grace Period Check
    if duration_minutes <= PARKING_GRACE_MINUTES:
        p_session.status = "PARKING_FREE"
        p_session.exit_time = now
        p_session.duration_minutes = duration_minutes
        p_session.amount = 0
        db.commit()

        tx = Transaction(
            session_id=p_session.session_id,
            gotag_id=payload.gotag_id,
            service_type="PARKING",
            amount=0,
            payment_ref="PARKING_GRACE_FREE",
            status="PAID",
            algorand_tx_id=None,
        )
        db.add(tx)
        db.commit()

        return {
            "success": True,
            "status": "PARKING_FREE",
            "session_id": p_session.session_id,
            "gotag_id": payload.gotag_id,
            "duration_minutes": duration_minutes,
            "amount": 0,
            "reason": f"Within {PARKING_GRACE_MINUTES}-minute grace period",
            "barrier_open": True,
        }

    # Ceil billable hours calculation
    billable_hours = math.ceil(duration_minutes / 60.0)
    amount_micros = int(billable_hours * PARKING_RATE_PER_HOUR_MICROS)
    p_session.status = "PAYMENT_PENDING"
    p_session.exit_time = now
    p_session.duration_minutes = duration_minutes
    p_session.billable_hours = billable_hours
    p_session.amount = amount_micros
    db.commit()

    req = create_payment_request(
        payload.gotag_id,
        "PARK-001",
        amount_micros,
        "Parking Central Mall",
        usage={
            "duration_minutes": duration_minutes,
            "billable_hours": billable_hours,
            "rate_per_hour_gtusd": PARKING_RATE_PER_HOUR_MICROS / 1_000_000,
            "total_gtusd": amount_micros / 1_000_000,
        },
    )
    req["session_id"] = p_session.session_id
    return JSONResponse(status_code=402, content=req)


# ---------------------------------------------------------------------------
# X402 ENDPOINTS
# ---------------------------------------------------------------------------


def _calculate_amount_from_usage(
    usage: dict[str, Any] | None,
    service_slug: str,
    fallback_amount: int,
) -> tuple[int, dict[str, Any] | None]:
    """
    When the machine provides usage data, derive the authoritative amount.
    Returns (amount_micros, enriched_usage_dict_or_None).
    """
    if not usage:
        return fallback_amount, None

    enriched: dict[str, Any] = dict(usage)

    if service_slug == "fuel":
        quantity = float(usage.get("quantity", 0) or 0)
        if quantity > 0:
            amount_micros = int(round(quantity * FUEL_PRICE_PER_LITRE_MICROS))
            unit_price = FUEL_PRICE_PER_LITRE_MICROS / 1_000_000
            enriched.update({
                "unit": usage.get("unit", "L"),
                "unit_price_gtusd": unit_price,
                "total_gtusd": amount_micros / 1_000_000,
            })
            return amount_micros, enriched

    if service_slug == "ev":
        energy = float(usage.get("energy", 0) or 0)
        if energy > 0:
            amount_micros = int(round(energy * EV_PRICE_PER_KWH_MICROS))
            unit_price = EV_PRICE_PER_KWH_MICROS / 1_000_000
            enriched.update({
                "unit": usage.get("unit", "kWh"),
                "unit_price_gtusd": unit_price,
                "total_gtusd": amount_micros / 1_000_000,
            })
            return amount_micros, enriched

    return fallback_amount, enriched if enriched else None


@app.post("/api/x402/fuel")
def x402_fuel(
    payload: PaymentRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    amount, usage_enriched = _calculate_amount_from_usage(
        payload.usage, "fuel", payload.amount
    )
    req = create_payment_request(
        payload.gotag_id, payload.service_id or "FUEL-001", amount, "Fuel Station #01",
        usage=usage_enriched,
    )
    return _finalize_x402(req, payload, db, authoritative_amount=amount)


@app.post("/api/x402/ev")
def x402_ev(
    payload: PaymentRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    amount, usage_enriched = _calculate_amount_from_usage(
        payload.usage, "ev", payload.amount
    )
    req = create_payment_request(
        payload.gotag_id, payload.service_id or "EV-001", amount, "EV Charging Station #01",
        usage=usage_enriched,
    )
    return _finalize_x402(req, payload, db, authoritative_amount=amount)


@app.post("/api/x402/toll")
def x402_toll(
    payload: PaymentRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    req = create_payment_request(
        payload.gotag_id, payload.service_id or "TOLL-001", payload.amount, "Toll Gate #01"
    )
    return _finalize_x402(req, payload, db)


@app.post("/api/x402/parking")
def x402_parking(
    payload: PaymentRequest, db: Session = Depends(get_db_session)
) -> dict[str, Any]:
    req = create_payment_request(
        payload.gotag_id, payload.service_id or "PARK-001", payload.amount, "Parking Zone A"
    )
    return _finalize_x402(req, payload, db)


def _finalize_x402(
    req: dict[str, Any],
    payload: PaymentRequest,
    db: Session,
    authoritative_amount: int | None = None,
) -> dict[str, Any]:
    """
    Core x402 handler.

    authoritative_amount: the backend-calculated amount from machine usage.
    When provided, all payment validation is done against this value, not
    the client-supplied payload.amount.
    """
    effective_amount = authoritative_amount if authoritative_amount is not None else payload.amount

    vehicle = db.get(
        Vehicle,
        payload.gotag_id,
    )

    if not vehicle:
        raise HTTPException(
            status_code=404,
            detail="Vehicle not found",
        )

    if vehicle.status != "ACTIVE":
        raise HTTPException(
            status_code=403,
            detail="Vehicle is blocked",
        )

    if payload.payment_data and payload.payment_data.get("sender"):
        sender_wallet = str(payload.payment_data.get("sender")).strip()
        if vehicle.owner_wallet.strip().upper() != sender_wallet.upper():
            raise HTTPException(
                status_code=403,
                detail=f"GoTag ownership mismatch. Vehicle {payload.gotag_id} is registered to {vehicle.owner_wallet}, not connected wallet {sender_wallet}.",
            )

    # Spending policy: check against backend-authoritative amount.
    if vehicle.spending_limit < vehicle.spent_amount + effective_amount:
        raise HTTPException(
            status_code=400,
            detail="Spending limit exceeded.",
        )

    # ------------------------------------------------------------
    # REAL PAYMENT DATA FROM FRONTEND
    # ------------------------------------------------------------

    if not payload.payment_data or not payload.payment_data.get("tx_id"):
        return JSONResponse(status_code=402, content=req)

    # ------------------------------------------------------------------
    # From here, payment_data is present — validate against backend amount
    # ------------------------------------------------------------------

    payment_data = payload.payment_data

    # ------------------------------------------------------------
    # VALIDATE PAYMENT DATA AGAINST THE SESSION
    # ------------------------------------------------------------

    payment_amount = payment_data.get("amount")

    if payment_amount is None:
        raise HTTPException(
            status_code=400,
            detail="Payment amount is required",
        )

    # Validate against the backend-authoritative amount, not frontend amount.
    if int(payment_amount) != int(effective_amount):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Payment amount mismatch: expected {effective_amount}, "
                f"got {payment_amount}"
            ),
        )

    payment_receiver = payment_data.get("receiver") or payment_data.get("to")

    if payment_receiver != SETTLEMENT_AUTHORITY:
        raise HTTPException(
            status_code=400,
            detail="Payment receiver does not match settlement authority",
        )

    payment_asset_id = payment_data.get("asset_id")

    if payment_asset_id is None:
        raise HTTPException(
            status_code=400,
            detail="Payment asset ID is required",
        )

    if int(payment_asset_id) != int(GOTAG_PAYMENT_ASSET_ID):
        raise HTTPException(
            status_code=400,
            detail="Payment asset does not match GTUSD",
        )

    payment_sender = payment_data.get("sender")

    if not payment_sender:
        raise HTTPException(
            status_code=400,
            detail="Payment sender is required",
        )

    if payment_sender != vehicle.owner_wallet:
        raise HTTPException(
            status_code=400,
            detail="Payment sender does not match vehicle wallet",
        )

    # ------------------------------------------------------------
    # REAL ALGORAND TRANSACTION ID
    # ------------------------------------------------------------

    payment_ref = str(payment_data.get("tx_id") or "").strip()

    if not payment_ref:
        raise HTTPException(
            status_code=400,
            detail="Algorand transaction ID is required",
        )

    logger.info(
        "Verifying real TestNet payment",
        extra={
            "session_id": req.get("payment_ref"),
            "tx_id": payment_ref,
            "gotag_id": payload.gotag_id,
            "service_id": payload.service_id,
            "amount": payload.amount,
            "asset_id": payment_asset_id,
        },
    )

    # ------------------------------------------------------------
    # VERIFY REAL TESTNET TRANSACTION
    # ------------------------------------------------------------

    if not verify_payment(
        payment_ref,
        payment_data,
    ):
        raise HTTPException(
            status_code=402,
            detail="Payment verification failed",
        )

    # ------------------------------------------------------------
    # SETTLE VERIFIED PAYMENT
    # ------------------------------------------------------------

    settled = settle_payment(
        payment_ref,
        payment_data,
    )

    if not settled.get("success"):
        raise HTTPException(
            status_code=400,
            detail="Payment settlement failed",
        )

    # The real Algorand transaction ID remains the payment reference.
    confirmed_tx_id = str(settled.get("tx_id") or payment_ref)

    # ------------------------------------------------------------
    # CREATE PAID SESSION
    # ------------------------------------------------------------

    session_id = f"SESSION-" f"{uuid.uuid4().hex[:8].upper()}"

    session = SessionModel(
        session_id=session_id,
        gotag_id=payload.gotag_id,
        service_id=payload.service_id or "FUEL-001",
        amount=effective_amount,
        status="PAID",
        payment_ref=confirmed_tx_id,
    )

    db.add(session)

    # Update vehicle spending only after successful
    # on-chain payment verification (authoritative amount).
    vehicle.spent_amount += effective_amount

    db.commit()

    # ------------------------------------------------------------
    # RECORD PAYMENT ON GO TAG CONTRACT
    # ------------------------------------------------------------

    record_payment_onchain(
        session_id,
        confirmed_tx_id,
    )

    # ------------------------------------------------------------
    # DATABASE TRANSACTION RECORD
    # ------------------------------------------------------------

    service = db.get(
        Service,
        payload.service_id,
    )

    service_type = service.service_type if service else "FUEL"

    tx = Transaction(
        session_id=session_id,
        gotag_id=payload.gotag_id,
        service_type=service_type,
        amount=effective_amount,
        payment_ref=confirmed_tx_id,
        status="PAID",
        algorand_tx_id=confirmed_tx_id,
    )

    db.add(tx)
    db.commit()

    # Update active TollJourney or ParkingSession if applicable
    toll_j = db.execute(
        select(TollJourney)
        .where(TollJourney.gotag_id == payload.gotag_id)
        .where(TollJourney.status == "PAYMENT_PENDING")
    ).scalars().first()
    if toll_j:
        toll_j.status = "PAID"
        toll_j.payment_ref = confirmed_tx_id
        toll_j.algorand_tx_id = confirmed_tx_id

    parking_s = db.execute(
        select(ParkingSession)
        .where(ParkingSession.gotag_id == payload.gotag_id)
        .where(ParkingSession.status == "PAYMENT_PENDING")
    ).scalars().first()
    if parking_s:
        parking_s.status = "PAID"
        parking_s.payment_ref = confirmed_tx_id
        parking_s.algorand_tx_id = confirmed_tx_id

    db.commit()

    # ------------------------------------------------------------
    # FINAL RESPONSE
    # ------------------------------------------------------------

    return {
        "success": True,
        "session_id": session_id,
        "gotag_id": payload.gotag_id,
        "service": payload.service_id,
        "amount": effective_amount,
        "payment_ref": confirmed_tx_id,
        "status": "PAID",
        "network": "Algorand TestNet",
        "demo_mode": False,
        "algorand_tx_id": confirmed_tx_id,
        "service_authorized": True,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
