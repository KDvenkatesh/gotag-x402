from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from backend.config import (
    DEMO_MODE,
    GOTAG_APP_ID,
    GOTAG_PAYMENT_ASSET_ID,
    SETTLEMENT_AUTHORITY,
)
from backend.models import Service, Vehicle

SERVICE_TYPE_MAP = {
    "fuel": "FUEL",
    "ev": "EV",
    "parking": "PARKING",
    "toll": "TOLL",
}


def sanitize_plate(plate_number: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", plate_number.upper())
    return cleaned[:8] if cleaned else "AP39"


def generate_gotag_id(plate_number: str) -> str:
    clean = sanitize_plate(plate_number)
    if len(clean) < 4:
        clean = (clean + "0000")[:4]
    suffix = str(uuid.uuid4().int % 10_000).zfill(4)
    prefix = clean[:4]
    return f"GT-{prefix}-{suffix}"


def build_demo_vehicle(plate_number: str, owner_name: str, owner_wallet: str, vehicle_type: str = "Car") -> Vehicle:
    return Vehicle(
        gotag_id=generate_gotag_id(plate_number),
        plate_number=plate_number.upper(),
        owner_name=owner_name,
        owner_wallet=owner_wallet,
        vehicle_type=vehicle_type,
        status="ACTIVE",
        spending_limit=100_000_000,
        spent_amount=0,
        created_at=datetime.now(timezone.utc),
    )


def build_demo_service(service_id: str, provider: str, service_type: str, price_per_unit: int) -> Service:
    return Service(
        service_id=service_id,
        provider=provider,
        service_type=SERVICE_TYPE_MAP.get(service_type.lower(), service_type.upper()),
        price_per_unit=price_per_unit,
        status="ACTIVE",
        created_at=datetime.now(timezone.utc),
    )


def register_vehicle_onchain(gotag_id: str, plate_number: str, owner_wallet: str, spending_limit: int) -> dict:
    if DEMO_MODE:
        return {
            "success": True,
            "mode": "demo",
            "message": "Demo registration recorded; blockchain integration remains available via GoTagContract.",
            "app_id": GOTAG_APP_ID,
            "payment_asset_id": GOTAG_PAYMENT_ASSET_ID,
            "settlement_authority": SETTLEMENT_AUTHORITY,
            "gotag_id": gotag_id,
            "plate_number": plate_number,
            "owner_wallet": owner_wallet,
            "spending_limit": spending_limit,
        }
    return {
        "success": False,
        "mode": "not-configured",
        "message": "Algorand app integration is not configured for live contract calls in this environment.",
        "gotag_id": gotag_id,
    }


def register_service_onchain(service_id: str, provider: str, service_type: str, amount: int) -> dict:
    if DEMO_MODE:
        return {
            "success": True,
            "mode": "demo",
            "service_id": service_id,
            "provider": provider,
            "service_type": SERVICE_TYPE_MAP.get(service_type.lower(), service_type.upper()),
            "price_per_unit": amount,
            "app_id": GOTAG_APP_ID,
        }
    return {"success": False, "mode": "not-configured"}


def create_session_onchain(session_id: str, gotag_id: str, service_id: str, amount: int) -> dict:
    if DEMO_MODE:
        return {
            "success": True,
            "mode": "demo",
            "session_id": session_id,
            "gotag_id": gotag_id,
            "service_id": service_id,
            "amount": amount,
            "app_id": GOTAG_APP_ID,
        }
    return {"success": False, "mode": "not-configured"}


def record_payment_onchain(session_id: str, payment_ref: str) -> dict:
    if DEMO_MODE:
        return {
            "success": True,
            "mode": "demo",
            "session_id": session_id,
            "payment_ref": payment_ref,
            "app_id": GOTAG_APP_ID,
            "asset_id": GOTAG_PAYMENT_ASSET_ID,
            "settlement_authority": SETTLEMENT_AUTHORITY,
            "tx_id": f"demo-tx-{uuid.uuid4().hex[:16]}",
        }
    return {"success": False, "mode": "not-configured"}


def get_vehicle_for_chain(gotag_id: str) -> dict:
    return {"gotag_id": gotag_id, "status": "ACTIVE", "spending_limit": 100_000_000, "spent_amount": 0}


def get_service_for_chain(service_id: str) -> dict:
    return {"service_id": service_id, "status": "ACTIVE", "service_type": "FUEL", "price_per_unit": 10_000_000}


def get_session_for_chain(session_id: str) -> dict:
    return {"session_id": session_id, "status": "PENDING", "amount": 0, "payment_ref": ""}
