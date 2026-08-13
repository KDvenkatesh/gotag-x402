# GoTag — Full-Stack x402 Vehicle Payment Network

GoTag is a demo vehicle payment pass built around the existing Algorand smart contract at application ID 769016959. The project keeps the deployed contract and ABI intact while layering a FastAPI backend and React dashboard around it for a hackathon-ready MVP.

## 1. Project overview

The product is designed around a simple flow:

Register vehicle → generate GoTag → scan QR → choose service → HTTP 402 → x402 payment → record on-chain settlement → service completes.

The blockchain remains the source of truth for settlement and auditability. The backend database is used for fast lookup and UX convenience without replacing the smart contract.

## 2. Architecture

- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Python + FastAPI + SQLite
- Blockchain: Algorand TestNet + existing GoTagContract
- Payment flow: x402 mock adapter with demo settlement, ready to swap for a real facilitator

ANPR/QR/NFC are physical-world identification mechanisms. x402 handles payment. Algorand provides settlement and auditability.

## 3. Frontend setup

```bash
cd projects/gotag/frontend
npm install
npm run dev -- --host 0.0.0.0
```

The app runs on http://localhost:5173.

## 4. Backend setup

```bash
cd projects/gotag
. .venv/Scripts/activate
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## 5. Environment variables

Create a project-level .env file with values like:

```env
BACKEND_DEMO_MODE=true
VITE_DEMO_MODE=true
ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGOD_TOKEN=
ALGOD_NETWORK=testnet
GOTAG_APP_ID=769016959
GOTAG_PAYMENT_ASSET_ID=769016907
SETTLEMENT_AUTHORITY=35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM
FRONTEND_URL=http://localhost:5173
DATABASE_URL=sqlite:///./gotag.db
```

Never expose private keys or mnemonics in frontend code or logs.

## 6. Algorand TestNet configuration

The project is configured to work with the deployed TestNet contract and asset IDs already in use:

- App ID: 769016959
- Payment Asset ID: 769016907
- Settlement authority: 35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM

The backend uses these values as demo defaults while preserving the actual smart contract ABI and deployed setup.

## 7. x402 architecture

The client does not contain settlement authority or private keys. The request path is:

React → FastAPI → service request → HTTP 402 → x402 payment verification → settlement → record_payment() → success

The mock adapter is deliberately isolated so a real facilitator can replace it later without changing the frontend flow.

## 8. Demo flow

1. Connect wallet or use demo wallet state
2. Register vehicle
3. Generate GoTag QR
4. Scan QR
5. Select Fuel / Toll / EV Charging / Parking
6. Enter amount
7. Payment required response appears
8. x402 mock checkout verifies payment
9. Settlement and transaction history are updated

## 9. How QR scanning works

The QR scan uses a browser camera and reads the stable identifier, such as GT-AP39-0001. The QR encodes only the GoTag ID; it does not include wallet or secret data.

## 10. How number-plate lookup works

The backend exposes a lookup endpoint that resolves vehicle metadata from the number plate to the registered GoTag record. This is structured to be replaced by a real ANPR camera system later.

## 11. How to run frontend

```bash
cd projects/gotag/frontend
npm install
npm run dev
```

## 12. How to run backend

```bash
cd projects/gotag
. .venv/Scripts/activate
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## 13. Demo notes

This repository preserves the existing smart contract. The generated client is already present under the smart contract artifacts folder, and the backend app wraps it with a user-friendly Python/FastAPI and React experience.

## 14. Testing

```bash
cd projects/gotag
. .venv/Scripts/activate
python -m pytest -q
```

The backend includes smoke tests for registration, lookup, mock x402 payment verification, and service flow.

