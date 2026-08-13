from __future__ import annotations

import base64
import logging
import uuid
from typing import Any

from algosdk.encoding import decode_address
from algosdk.v2client.algod import AlgodClient

from backend.config import (
    ALGOD_SERVER,
    ALGOD_TOKEN,
    GOTAG_PAYMENT_ASSET_ID,
    SETTLEMENT_AUTHORITY,
)

logger = logging.getLogger("backend.x402")


def build_real_payment_request(
    gotag_id: str,
    service_id: str,
    amount: int,
    service_name: str | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payment_ref = f"GTUSD-{uuid.uuid4().hex[:12].upper()}"

    service_block: dict[str, Any] = {
        "service_id": service_id,
        "name": service_name or service_id,
    }
    if usage:
        service_block.update(usage)

    return {
        "status": 402,
        "payment_required": True,
        "gotag_id": gotag_id,
        "service_id": service_id,
        "service_name": service_name or service_id,
        "amount": int(amount),
        "currency": "GTUSD",
        "network": "Algorand TestNet",
        "asset_id": int(GOTAG_PAYMENT_ASSET_ID),
        "to": SETTLEMENT_AUTHORITY,
        "from": None,
        "payment_ref": payment_ref,
        "message": (
            "Transfer GTUSD to the settlement authority to complete payment."
        ),
        "demo_mode": False,
        "payment": {
            "scheme": "exact",
            "network": "algorand-testnet",
            "currency": "GTUSD",
            "asset_id": int(GOTAG_PAYMENT_ASSET_ID),
            "amount": int(amount),
            "receiver": SETTLEMENT_AUTHORITY,
        },
        "service": service_block,
        "asset-transfer": {
            "sender": None,
            "receiver": SETTLEMENT_AUTHORITY,
            "asset_id": int(GOTAG_PAYMENT_ASSET_ID),
            "amount": int(amount),
        },
    }


def create_payment_request(
    gotag_id: str,
    service_id: str,
    amount: int,
    service_name: str | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return build_real_payment_request(
        gotag_id,
        service_id,
        amount,
        service_name,
        usage=usage,
    )


def _get_asset_transfer(payment_data: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize the frontend payment payload.

    The frontend may send the transfer fields either at the top level
    or inside `asset-transfer`.
    """
    nested = payment_data.get("asset-transfer")

    if isinstance(nested, dict):
        return nested

    return payment_data


def _decode_algorand_address(value: Any) -> str | None:
    """
    Algod returns address bytes as base64 in transaction JSON.
    Convert them to the normal Algorand address format.
    """
    if not value:
        return None

    if isinstance(value, bytes):
        try:
            return decode_address(base64.b64encode(value).decode("ascii"))
        except Exception:
            return None

    if not isinstance(value, str):
        return None

    # Already looks like a normal Algorand address.
    if len(value) == 58:
        try:
            decode_address(value)
            return value
        except Exception:
            pass

    # Otherwise try base64-decoded address bytes.
    try:
        raw = base64.b64decode(value)
        if len(raw) != 32:
            return None

        return decode_address(value)
    except Exception:
        return None


def _extract_onchain_transfer(
    transaction_info: dict[str, Any],
) -> dict[str, Any]:
    """
    Extract the relevant fields from an Algorand TestNet
    asset-transfer transaction.

    Handles both pending_transaction_info() and
    transaction_info() response structures.
    """
    txn = transaction_info.get("txn") or transaction_info.get("transaction") or {}

    # Pending transaction responses normally have:
    #
    # {
    #   "txn": {
    #       "txn": {
    #           "snd": "...",
    #           "arcv": "...",
    #           "xaid": 123,
    #           "aamt": 100
    #       }
    #   }
    # }
    #
    # Other algod responses can expose the transaction one level
    # differently, so normalize it carefully.

    if isinstance(txn, dict) and isinstance(txn.get("txn"), dict):
        inner = txn["txn"]
    else:
        inner = txn

    if not isinstance(inner, dict):
        inner = {}

    sender_raw = inner.get("snd") or inner.get("sender")

    receiver_raw = inner.get("arcv") or inner.get("rcv") or inner.get("receiver")

    asset_raw = inner.get("xaid") or inner.get("asset-id") or inner.get("asset_id")

    amount_raw = (
        inner.get("aamt")
        if inner.get("aamt") is not None
        else inner.get("asset_amount")
    )

    # Some representations use `amt`; however for an ASA transfer
    # the canonical field is aamt.
    if amount_raw is None:
        amount_raw = inner.get("amt")

    sender = _decode_algorand_address(sender_raw)
    receiver = _decode_algorand_address(receiver_raw)

    try:
        asset_id = int(asset_raw) if asset_raw is not None else None
    except (TypeError, ValueError):
        asset_id = None

    try:
        amount = int(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        amount = None

    return {
        "sender": sender,
        "receiver": receiver,
        "asset_id": asset_id,
        "amount": amount,
    }


import time


def _get_transaction_info(
    algod: AlgodClient,
    tx_id: str,
) -> dict[str, Any] | None:
    """
    Get the actual transaction from Algorand TestNet via algod with retry.
    """
    for attempt in range(5):
        try:
            info = algod.pending_transaction_info(tx_id)
            if info:
                return info
        except Exception as exc:
            logger.warning(
                f"pending_transaction_info lookup attempt {attempt + 1} failed",
                extra={"txid": tx_id, "error": str(exc)},
            )
        if attempt < 4:
            time.sleep(1.5)

    return None


def asset_transfer_matches_expected(
    transfer: dict[str, Any] | None,
    sender: str,
    asset_id: int,
    amount: int,
    receiver: str,
) -> bool:
    if not transfer or not isinstance(transfer, dict):
        return False

    actual = _get_asset_transfer(transfer)

    actual_sender = str(actual.get("sender") or "").strip().upper()
    actual_receiver = str(actual.get("receiver") or "").strip().upper()
    actual_asset_id = actual.get("asset_id")
    actual_amount = actual.get("amount")

    if actual_sender != sender.strip().upper():
        return False

    if actual_receiver != receiver.strip().upper():
        return False

    try:
        if int(actual_asset_id) != int(asset_id):
            return False
    except (TypeError, ValueError):
        return False

    try:
        if int(actual_amount) != int(amount):
            return False
    except (TypeError, ValueError):
        return False

    return True


def verify_payment(
    payment_ref: str,
    payment_data: dict[str, Any] | None = None,
) -> bool:
    """
    Verify a REAL GTUSD ASA transfer on Algorand TestNet.

    This function does NOT trust the frontend values alone.

    It verifies:
      1. transaction ID exists
      2. transaction exists on Algorand
      3. transaction is confirmed
      4. transaction is an ASA transfer
      5. sender matches frontend payment data
      6. receiver matches settlement authority
      7. asset ID matches GTUSD
      8. amount matches frontend payment data
    """

    if not payment_ref:
        logger.warning("Payment verification failed: missing tx id")
        return False

    if not isinstance(payment_data, dict):
        logger.warning("Payment verification failed: payment_data is missing")
        return False

    tx_id = str(
        payment_data.get("tx_id") or payment_data.get("transaction_id") or payment_ref
    ).strip()

    if not tx_id:
        logger.warning("Payment verification failed: empty transaction ID")
        return False

    transfer = _get_asset_transfer(payment_data)

    expected_sender = payment_data.get("sender") or transfer.get("sender")

    expected_receiver = (
        payment_data.get("receiver")
        or payment_data.get("to")
        or transfer.get("receiver")
        or SETTLEMENT_AUTHORITY
    )

    expected_asset_id = payment_data.get("asset_id") or transfer.get("asset_id")

    expected_amount = (
        payment_data.get("amount")
        if payment_data.get("amount") is not None
        else transfer.get("amount")
    )

    # Never accept an arbitrary asset or receiver from the client.
    if str(expected_receiver or "").strip().upper() != SETTLEMENT_AUTHORITY.strip().upper():
        logger.warning("Payment verification failed: receiver mismatch")
        return False

    try:
        if int(expected_asset_id) != int(GOTAG_PAYMENT_ASSET_ID):
            logger.warning("Payment verification failed: asset ID mismatch")
            return False
    except (TypeError, ValueError):
        logger.warning("Payment verification failed: invalid asset ID")
        return False

    try:
        expected_amount = int(expected_amount)
    except (TypeError, ValueError):
        logger.warning("Payment verification failed: invalid amount")
        return False

    if expected_amount <= 0:
        logger.warning("Payment verification failed: amount must be positive")
        return False

    if not expected_sender:
        logger.warning("Payment verification failed: sender missing")
        return False

    if not ALGOD_SERVER:
        logger.error(
            "ALGOD_SERVER is not configured; refusing " "to verify a real payment"
        )
        return False

    try:
        algod = AlgodClient(
            ALGOD_TOKEN or "",
            ALGOD_SERVER,
        )

        info = _get_transaction_info(
            algod,
            tx_id,
        )

        if not info:
            logger.warning(
                "Algorand transaction not found",
                extra={"txid": tx_id},
            )
            return False

        confirmed_round = (
            info.get("confirmed-round")
            or info.get("confirmedRound")
            or info.get("confirmed_round")
        )

        if not confirmed_round or int(confirmed_round) <= 0:
            logger.warning(
                "Algorand transaction is not confirmed",
                extra={"txid": tx_id},
            )
            return False

        onchain = _extract_onchain_transfer(info)

        onchain_sender = onchain.get("sender")
        onchain_receiver = onchain.get("receiver")
        onchain_asset_id = onchain.get("asset_id")
        onchain_amount = onchain.get("amount")

        if not onchain_sender:
            logger.warning(
                "Could not decode on-chain sender",
                extra={"txid": tx_id},
            )
            return False

        if not onchain_receiver:
            logger.warning(
                "Could not decode on-chain receiver",
                extra={"txid": tx_id},
            )
            return False

        if onchain_asset_id is None:
            logger.warning(
                "Could not read on-chain asset ID",
                extra={"txid": tx_id},
            )
            return False

        if onchain_amount is None:
            logger.warning(
                "Could not read on-chain asset amount",
                extra={"txid": tx_id},
            )
            return False

        # Sender
        if str(onchain_sender).strip().upper() != str(expected_sender).strip().upper():
            logger.warning(
                "On-chain sender mismatch",
                extra={"txid": tx_id},
            )
            return False

        # Receiver
        if str(onchain_receiver).strip().upper() != SETTLEMENT_AUTHORITY.strip().upper():
            logger.warning(
                "On-chain settlement receiver mismatch",
                extra={"txid": tx_id},
            )
            return False

        # Asset
        if int(onchain_asset_id) != int(GOTAG_PAYMENT_ASSET_ID):
            logger.warning(
                "On-chain GTUSD asset ID mismatch",
                extra={"txid": tx_id},
            )
            return False

        # Amount
        if int(onchain_amount) != int(expected_amount):
            logger.warning(
                "On-chain GTUSD amount mismatch",
                extra={"txid": tx_id},
            )
            return False

        logger.info(
            "REAL GTUSD TestNet payment verified",
            extra={
                "txid": tx_id,
                "confirmed_round": int(confirmed_round),
                "asset_id": int(onchain_asset_id),
                "amount": int(onchain_amount),
            },
        )

        return True

    except Exception:
        logger.exception(
            "Unexpected error during Algorand payment verification",
            extra={"txid": tx_id},
        )
        return False


def settle_payment(
    payment_ref: str,
    payment_data: dict[str, Any] | None = None,
) -> dict[str, Any]:

    final_ref = payment_ref or f"GTUSD-{uuid.uuid4().hex[:12].upper()}"

    if not isinstance(payment_data, dict):
        return {
            "success": False,
            "status": "FAILED",
            "payment_ref": final_ref,
            "network": "Algorand TestNet",
            "settlement": "none",
            "verified": False,
            "demo_mode": False,
        }

    tx_id = str(
        payment_data.get("tx_id") or payment_data.get("transaction_id") or ""
    ).strip()

    if not tx_id:
        return {
            "success": False,
            "status": "FAILED",
            "payment_ref": final_ref,
            "network": "Algorand TestNet",
            "settlement": "none",
            "verified": False,
            "demo_mode": False,
        }

    verified = verify_payment(
        tx_id,
        payment_data,
    )

    if not verified:
        return {
            "success": False,
            "status": "FAILED",
            "payment_ref": final_ref,
            "network": "Algorand TestNet",
            "settlement": "none",
            "verified": False,
            "demo_mode": False,
            "tx_id": tx_id,
        }

    return {
        "success": True,
        "status": "PAID",
        "payment_ref": tx_id,
        "network": "Algorand TestNet",
        "settlement": "gtusd-asset-transfer",
        "verified": True,
        "demo_mode": False,
        "asset_id": int(GOTAG_PAYMENT_ASSET_ID),
        "to": SETTLEMENT_AUTHORITY,
        "tx_id": tx_id,
    }


def record_onchain_payment(
    session_id: str,
    payment_ref: str,
    tx_id: str | None = None,
) -> dict[str, Any]:
    return {
        "success": True,
        "session_id": session_id,
        "payment_ref": payment_ref,
        "tx_id": tx_id,
        "recorded": True,
        "demo_mode": False,
    }
