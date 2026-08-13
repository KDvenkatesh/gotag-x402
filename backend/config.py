import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

APP_ENV = os.getenv("APP_ENV", "development")
DEMO_MODE = os.getenv("BACKEND_DEMO_MODE", "true").lower() == "true"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
db_default = "sqlite:////tmp/gotag.db" if os.getenv("VERCEL") else "sqlite:///./gotag.db"
DATABASE_URL = os.getenv("DATABASE_URL", db_default)

GOTAG_APP_ID = int(os.getenv("GOTAG_APP_ID", "769016959"))
GOTAG_PAYMENT_ASSET_ID = int(os.getenv("GOTAG_PAYMENT_ASSET_ID", "769016907"))
SETTLEMENT_AUTHORITY = os.getenv("SETTLEMENT_AUTHORITY", "35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM")
ALGOD_SERVER = os.getenv("ALGOD_SERVER", "")
ALGOD_TOKEN = os.getenv("ALGOD_TOKEN", "")
ALGOD_NETWORK = os.getenv("ALGOD_NETWORK", "testnet")

print(f"GoTag backend config loaded. DEMO_MODE={DEMO_MODE}, APP_ENV={APP_ENV}")
