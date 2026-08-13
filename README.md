# GoTag — Full-Stack x402 Vehicle Payment Network

> **One Pass. Every Road.**

A full-stack vehicle payment network built on **Algorand TestNet**, combining **x402 payments**, **FastAPI**, and **React** to create a unified payment pass for **tolls, fuel stations, EV charging, and parking services**.

---

## 🚀 Overview

GoTag is a next-generation vehicle payment pass that enables drivers to make seamless payments across multiple transportation services using a single identity.

Instead of managing separate payment systems for toll booths, fuel stations, parking lots, and EV charging points, users register their vehicle once and receive a unique **GoTag QR**. The payment process is powered by **HTTP 402**, **x402 payment verification**, and **Algorand blockchain settlement**.

The blockchain serves as the **source of truth** for transaction settlement and auditability, while the backend database provides fast lookups and a smooth user experience.

### Payment Flow

```text
Register Vehicle
       ↓
Generate GoTag
       ↓
Scan QR
       ↓
Choose Service
       ↓
HTTP 402 Payment Required
       ↓
x402 Payment Verification
       ↓
Algorand Settlement
       ↓
Service Completed
```

---

# 🎯 Problem Statement

Vehicle payment ecosystems today are fragmented and inefficient:

* Different services require different payment methods.
* Settlement between providers is often delayed.
* Transaction transparency is limited.
* Interoperability between service providers is poor.
* Traditional systems rely on centralized infrastructure with limited auditability.

GoTag solves these challenges by creating a blockchain-backed vehicle payment identity that works across multiple transportation services.

---

# 💡 Solution

GoTag provides:

* A unique QR-based vehicle identity.
* Unified payment experience across multiple services.
* Blockchain-backed transaction settlement.
* x402-powered payment verification.
* Real-time payment history and tracking.
* Future-ready architecture for ANPR and NFC integrations.

---

# ✨ Key Features

### Vehicle Registration

Register vehicles and generate unique GoTag identities.

### GoTag QR Generation

Every vehicle receives a secure QR code.

### QR-Based Payments

Scan and pay instantly without manual data entry.

### x402 Payment Flow

Uses HTTP 402 payment requests and x402 verification.

### Blockchain Settlement

Transactions are recorded through Algorand smart contracts.

### Vehicle Lookup

Find registered vehicle information using number plates.

### Transaction History

View completed transactions and settlement records.

### Future ANPR Support

Architecture supports automatic number plate recognition systems.

---

# 🏗️ System Architecture

```text
┌──────────────────┐
│  React Frontend  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ FastAPI Backend  │
└────────┬─────────┘
         │
         ├─────────────► SQLite Database
         │
         ▼
┌──────────────────┐
│ x402 Verification│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Algorand TestNet │
│ Smart Contract   │
└──────────────────┘
```

---

# 🛠️ Tech Stack

| Layer          | Technology       |
| -------------- | ---------------- |
| Frontend       | React            |
| Language       | TypeScript       |
| Build Tool     | Vite             |
| Styling        | Tailwind CSS     |
| Backend        | FastAPI          |
| Language       | Python           |
| Database       | SQLite           |
| Blockchain     | Algorand TestNet |
| Payment Layer  | x402             |
| Smart Contract | GoTagContract    |

---

# 🔗 Algorand Configuration

The project preserves the existing deployed smart contract and ABI.

| Configuration        | Value                                                      |
| -------------------- | ---------------------------------------------------------- |
| Network              | Algorand TestNet                                           |
| App ID               | 769016959                                                  |
| Payment Asset ID     | 769016907                                                  |
| Settlement Authority | 35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM |

---

# 📂 Project Structure

```text
GoTag/
│
├── backend/
│   ├── main.py
│   ├── api/
│   ├── services/
│   ├── database/
│   └── tests/
│
├── frontend/
│   ├── src/
│   ├── components/
│   ├── pages/
│   └── assets/
│
├── smart_contract/
│   ├── artifacts/
│   └── generated_client/
│
├── .env
└── README.md
```

---

# ⚙️ Installation

## Clone Repository

```bash
git clone https://github.com/yourusername/gotag.git
cd gotag
```

---

# 🖥️ Backend Setup

## Activate Virtual Environment

### Windows

```bash
. .venv/Scripts/activate
```

### Linux/macOS

```bash
source .venv/bin/activate
```

## Install Dependencies

```bash
pip install -r requirements.txt
```

## Run FastAPI Server

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Backend URL:

```text
http://localhost:8000
```

---

# 🌐 Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

---

# 🔐 Environment Variables

Create a `.env` file at the project root.

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

---

# 💳 x402 Payment Architecture

The application uses a modular x402 payment flow.

```text
React Frontend
        ↓
FastAPI Backend
        ↓
HTTP 402 Response
        ↓
x402 Verification
        ↓
Settlement Recording
        ↓
Algorand Smart Contract
        ↓
Success Response
```

The x402 adapter is intentionally isolated, allowing future integration with a real facilitator without modifying frontend logic.

---

# 📱 QR Workflow

Each registered vehicle receives a unique GoTag QR.

Example:

```text
GT-AP39-0001
```

The QR contains only the GoTag identifier.

It does NOT contain:

* Wallet addresses
* Private keys
* Personal data
* Sensitive credentials

---

# 🚘 Number Plate Lookup

The backend provides a lookup endpoint that maps vehicle numbers to registered GoTag records.

Example Flow:

```text
Vehicle Number
      ↓
Lookup API
      ↓
GoTag Record
      ↓
Vehicle Details
```

This module is designed for future integration with ANPR (Automatic Number Plate Recognition) systems.

---

# 🎬 Demo Flow

### Step 1

Connect wallet or enter demo mode.

### Step 2

Register a vehicle.

### Step 3

Generate a GoTag QR.

### Step 4

Scan the QR code.

### Step 5

Select a service:

* Toll
* Fuel
* EV Charging
* Parking

### Step 6

Enter payment amount.

### Step 7

Receive HTTP 402 Payment Required.

### Step 8

Complete x402 verification.

### Step 9

Settlement is recorded and transaction history updates.

---

# 🔌 API Endpoints

| Method | Endpoint        | Description              |
| ------ | --------------- | ------------------------ |
| POST   | /register       | Register vehicle         |
| GET    | /lookup/{plate} | Lookup vehicle           |
| POST   | /payment/verify | Verify x402 payment      |
| POST   | /service        | Start service payment    |
| GET    | /history        | View transaction history |

---

# 🧪 Testing

Run backend tests:

```bash
python -m pytest -q
```

Test coverage includes:

* Vehicle registration
* Vehicle lookup
* x402 payment verification
* Service payment flow
* Backend smoke testing

---

# 🗺️ Future Roadmap

### Phase 1

* QR-based vehicle payments
* x402 integration
* Algorand settlement

### Phase 2

* NFC GoTag cards
* Mobile application
* Merchant dashboard

### Phase 3

* ANPR integration
* Multi-city toll interoperability
* Real facilitator integration
* Algorand MainNet deployment

---

# 📸 Screenshots

Add screenshots before submission:

```text
/screenshots/dashboard.png
/screenshots/vehicle-registration.png
/screenshots/payment-flow.png
/screenshots/transaction-history.png
```

---

# 👥 Team

| Member            | Role                                          |
| ----------------- | --------------------------------------------- |
| K Dhanu Venkatesh | Full Stack Development & Algorand Integration |
| SK Ishaq          | Backend Development                           |
| Team Member       | Frontend Development                          |

---

# 🔒 Security Considerations

* Private keys are never exposed to clients.
* Settlement authority remains server-side.
* Wallet credentials are not stored in QR codes.
* Sensitive data is excluded from frontend logs.
* Environment variables protect blockchain configuration.

---

# 🌟 Why GoTag?

GoTag demonstrates how blockchain infrastructure can improve real-world transportation payments without exposing users to Web3 complexity.

Benefits:

* One pass for every road.
* Unified payment experience.
* Transparent settlements.
* Fast user experience.
* Future-ready architecture.
* Blockchain-backed auditability.

---

# 🏆 MIC Hackfest 2026

**GoTag — Full-Stack x402 Vehicle Payment Network**

Built using **Algorand TestNet**, **FastAPI**, **React**, and **x402 Payments** to showcase the future of interoperable vehicle payment infrastructure.

### One Pass. Every Road.
