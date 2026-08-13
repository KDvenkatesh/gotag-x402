
import random
import uuid
from fastapi.testclient import TestClient

from backend.database import init_db, session_scope
from backend.main import app
from backend.services.algorand_service import build_demo_service, build_demo_vehicle
from backend.services.x402_service import (
    create_payment_request,
    settle_payment,
    verify_payment,
)


def test_vehicle_registration_and_lookup():
    init_db()
    test_plate = f"AP39ZZ{random.randint(1000, 9999)}"
    with session_scope() as db:
        vehicle = build_demo_vehicle(test_plate, "Venky", "demo-wallet")
        db.add(vehicle)
        db.commit()
        lookup = db.query(type(vehicle)).filter_by(plate_number=test_plate).first()
        assert lookup is not None
        assert lookup.gotag_id.startswith("GT-")


def test_x402_mock_flow():
    req = create_payment_request("GT-AP39-0001", "FUEL-001", 10_000_000)
    assert req["status"] == 402
    assert req["payment_required"] is True
    assert req["amount"] == 10_000_000
    assert req["currency"] == "GTUSD"
    assert req["asset_id"] == 769016907
    assert req["payment_ref"]


def test_x402_mock_flow_with_usage():
    usage = {"quantity": 5.2, "unit": "L", "unit_price_gtusd": 2.0, "total_gtusd": 10.4}
    req = create_payment_request(
        "GT-AP39-0001", "FUEL-001", 10_400_000, "Fuel Station #01", usage=usage
    )
    assert req["status"] == 402
    assert req["amount"] == 10_400_000
    assert req["service"]["quantity"] == 5.2
    assert req["service"]["total_gtusd"] == 10.4


def test_service_lookup_and_demo_registration():
    service = build_demo_service("FUEL-001", "Fuel Station #01", "fuel", 10_000_000)
    assert service.service_id == "FUEL-001"
    assert service.price_per_unit == 10_000_000


def test_real_api_routes_work_for_demo_flow():
    init_db()
    client = TestClient(app)

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    vehicle = client.get("/api/vehicles/GT-AP39-0001")
    assert vehicle.status_code == 200
    assert vehicle.json()["gotag_id"] == "GT-AP39-0001"
    assert vehicle.json()["plate_number"] == "AP39XX1234"

    transactions = client.get("/api/transactions")
    assert transactions.status_code == 200
    assert isinstance(transactions.json(), list)

    session = client.post(
        "/api/sessions",
        json={"gotag_id": "GT-AP39-0001", "service_id": "FUEL-001", "amount": 10_000_000},
    )
    assert session.status_code == 200, session.text
    payload = session.json()
    assert payload["success"] is True
    assert payload["session_id"].startswith("SESSION-")


def test_fuel_usage_endpoint_calculates_price():
    client = TestClient(app)
    resp = client.post(
        "/api/services/fuel/usage",
        json={"gotag_id": "GT-AP39-0001", "quantity": 5.2, "unit": "L"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["quantity"] == 5.2
    assert data["unit_price_gtusd"] == 2.0
    assert abs(data["total_gtusd"] - 10.4) < 0.001
    assert data["amount_micros"] == 10_400_000
    assert data["currency"] == "GTUSD"
    assert data["asset_id"] == 769016907


def test_ev_usage_endpoint_calculates_price():
    client = TestClient(app)
    resp = client.post(
        "/api/services/ev/usage",
        json={"gotag_id": "GT-AP39-0001", "energy": 8.4, "unit": "kWh"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["energy"] == 8.4
    assert data["unit_price_gtusd"] == 0.25
    assert abs(data["total_gtusd"] - 2.1) < 0.001
    assert data["amount_micros"] == 2_100_000
    assert data["currency"] == "GTUSD"


def test_x402_fuel_with_usage_overrides_amount():
    client = TestClient(app)
    resp = client.post(
        "/api/x402/fuel",
        json={
            "gotag_id": "GT-AP39-0001",
            "service_id": "FUEL-001",
            "usage": {"quantity": 5.2, "unit": "L"},
        },
    )
    assert resp.status_code == 402
    data = resp.json()
    assert data["payment_required"] is True
    assert data["amount"] == 10_400_000
    assert data["payment"]["amount"] == 10_400_000
    assert data["service"]["quantity"] == 5.2


def test_x402_missing_payment_returns_402():
    client = TestClient(app)
    resp = client.post(
        "/api/x402/fuel",
        json={"gotag_id": "GT-AP39-0001", "service_id": "FUEL-001", "amount": 10_000_000},
    )
    assert resp.status_code == 402
    assert resp.json()["payment_required"] is True


def test_toll_entry_and_exit_within_free_window():
    client = TestClient(app)
    entry_resp = client.post(
        "/api/services/toll/entry",
        json={"gotag_id": "GT-AP39-0001", "toll_point_id": "TOLL-X-ENTRY"},
    )
    assert entry_resp.status_code == 200, entry_resp.text
    entry_data = entry_resp.json()
    assert entry_data["status"] == "JOURNEY_STARTED"
    assert entry_data["session_id"].startswith("TOLL-")

    # Immediate exit -> returned within 30-minute free window
    exit_resp = client.post(
        "/api/services/toll/exit",
        json={"gotag_id": "GT-AP39-0001", "toll_point_id": "TOLL-Y-EXIT"},
    )
    assert exit_resp.status_code == 200, exit_resp.text
    exit_data = exit_resp.json()
    assert exit_data["status"] == "FREE_RETURN"
    assert exit_data["amount"] == 0
    assert exit_data["barrier_open"] is True


def test_parking_entry_and_exit_grace_period():
    client = TestClient(app)
    entry_resp = client.post(
        "/api/services/parking/entry",
        json={"gotag_id": "GT-AP39-0001", "location_id": "PARK-001"},
    )
    assert entry_resp.status_code == 200, entry_resp.text
    entry_data = entry_resp.json()
    assert entry_data["status"] == "PARKED"
    assert entry_data["session_id"].startswith("PARK-")

    active_resp = client.get("/api/services/parking/active/GT-AP39-0001")
    assert active_resp.status_code == 200
    assert active_resp.json()["active"] is True

    # Immediate exit -> within 15-minute grace period
    exit_resp = client.post(
        "/api/services/parking/exit",
        json={"gotag_id": "GT-AP39-0001", "location_id": "PARK-001"},
    )
    assert exit_resp.status_code == 200, exit_resp.text
    exit_data = exit_resp.json()
    assert exit_data["status"] == "PARKING_FREE"
    assert exit_data["amount"] == 0
    assert exit_data["barrier_open"] is True


def test_wallet_topup_endpoint():
    client = TestClient(app)
    topup_resp = client.post(
        "/api/wallet/topup",
        json={"gotag_id": "GT-AP39-0001", "amount": 50_000_000},
    )
    assert topup_resp.status_code == 200, topup_resp.text
    data = topup_resp.json()
    assert data["success"] is True
    assert data["amount_gtusd"] == 50.0
    assert data["status"] == "CONFIRMED"
    assert data["asset_id"] == 769016907
    assert data["payment_ref"].startswith("TOPUP-")


def test_wallet_identity_isolation():
    client = TestClient(app)
    # Test 1: Registered Wallet (Wallet A)
    wallet_a = "35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM"
    res_a = client.get(f"/api/vehicles/by-wallet/{wallet_a}")
    assert res_a.status_code == 200
    data_a = res_a.json()
    assert data_a["registered"] is True
    assert data_a["primary_vehicle"]["gotag_id"] == "GT-AP39-0001"

    # Test 2: Unregistered New Wallet (Wallet B - Unique for each test run)
    wallet_b = f"WALLETB_{uuid.uuid4().hex[:12].upper()}"
    res_b = client.get(f"/api/vehicles/by-wallet/{wallet_b}")
    assert res_b.status_code == 200
    data_b = res_b.json()
    assert data_b["registered"] is False
    assert data_b["vehicles"] == []
    assert data_b["primary_vehicle"] is None

    # Test 3: Transaction Filtering
    res_tx_b = client.get(f"/api/transactions?wallet_address={wallet_b}")
    assert res_tx_b.status_code == 200
    assert res_tx_b.json() == []

    # Test 4: Register new vehicle for Wallet B
    test_plate_b = f"AP99{uuid.uuid4().hex[:4].upper()}"
    reg_resp = client.post(
        "/api/vehicles/register",
        json={
            "plate_number": test_plate_b,
            "owner_name": "Wallet B User",
            "owner_wallet": wallet_b,
            "vehicle_type": "EV",
            "spending_limit": 50000000,
        },
    )
    assert reg_resp.status_code == 200
    new_gotag = reg_resp.json()["gotag_id"]

    # Verify Wallet B now sees its vehicle
    res_b_after = client.get(f"/api/vehicles/by-wallet/{wallet_b}")
    assert res_b_after.json()["registered"] is True
    assert res_b_after.json()["primary_vehicle"]["gotag_id"] == new_gotag

    # Verify Wallet A does NOT see Wallet B's vehicle
    res_a_check = client.get(f"/api/vehicles/by-wallet/{wallet_a}")
    assert res_a_check.json()["primary_vehicle"]["gotag_id"] == "GT-AP39-0001"




