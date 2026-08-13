from algopy import (
    ARC4Contract,
    BoxMap,
    Bytes,
    GlobalState,
    Txn,
    UInt64,
    arc4,
)


# ============================================================
# CONSTANTS
# ============================================================

# Vehicle status
STATUS_ACTIVE = 1
STATUS_BLOCKED = 2

# Session status
SESSION_PENDING = 1
SESSION_COMPLETED = 2
SESSION_CANCELLED = 3

# Physical service types
SERVICE_FUEL = 1
SERVICE_EV_CHARGING = 2
SERVICE_PARKING = 3
SERVICE_TOLL = 4


# ============================================================
# ARC-4 STRUCTS
# ============================================================

class VehicleRecord(arc4.Struct):
    owner: arc4.Address
    status: arc4.UInt64
    spending_limit: arc4.UInt64
    spent_amount: arc4.UInt64


class ServiceRecord(arc4.Struct):
    provider: arc4.Address
    service_type: arc4.UInt64
    status: arc4.UInt64
    price_per_unit: arc4.UInt64


class SessionRecord(arc4.Struct):
    gotag_id: arc4.String
    service_id: arc4.String
    payer: arc4.Address
    status: arc4.UInt64
    amount: arc4.UInt64
    payment_ref: arc4.String


# ============================================================
# GOTAG CONTRACT
# ============================================================

class GoTagContract(ARC4Contract):
    """
    GoTag MVP

    GoTag is an x402 + Algorand payment infrastructure
    for physical-world services.

    Supported services:

        1 = Fuel
        2 = EV Charging
        3 = Parking
        4 = Toll

    The smart contract DOES NOT implement HTTP x402.

    x402 is handled by the off-chain backend/facilitator.

    Intended architecture:

        Vehicle
           |
           v
        GoTag Backend
           |
           v
        Service API
           |
           v
        HTTP 402
           |
           v
        x402
           |
           v
        Algorand / USDC
           |
           v
        GoTag Contract
           |
           v
        Service completed
    """

    # ========================================================
    # CONSTRUCTOR
    # ========================================================

    def __init__(self) -> None:

        # ----------------------------------------------------
        # GLOBAL STATE
        # ----------------------------------------------------

        # Administrator address
        self.admin = GlobalState(Bytes)

        # Address authorized to record successful x402
        # settlements.
        self.settlement_authority = GlobalState(Bytes)

        # Algorand USDC asset ID
        self.payment_asset_id = GlobalState(UInt64)

        # 0 = not initialized
        # 1 = initialized
        self.initialized = GlobalState(UInt64)

        # ----------------------------------------------------
        # BOX STORAGE
        # ----------------------------------------------------

        # GoTag ID -> VehicleRecord
        self.vehicles = BoxMap(
            Bytes,
            VehicleRecord,
            key_prefix="v:",
        )

        # Service ID -> ServiceRecord
        self.services = BoxMap(
            Bytes,
            ServiceRecord,
            key_prefix="s:",
        )

        # Session ID -> SessionRecord
        self.sessions = BoxMap(
            Bytes,
            SessionRecord,
            key_prefix="ss:",
        )

    # ========================================================
    # CREATE
    # ========================================================

    @arc4.baremethod(
        allow_actions=["NoOp"],
        create="require",
    )
    def create(self) -> None:
        """
        Deploy the application.

        The creator becomes the initial admin and
        settlement authority.
        """

        self.admin.value = Txn.sender.bytes

        self.settlement_authority.value = Txn.sender.bytes

        self.payment_asset_id.value = UInt64(0)

        self.initialized.value = UInt64(0)

    # ========================================================
    # INITIALIZE
    # ========================================================

    @arc4.abimethod()
    def initialize(
        self,
        payment_asset_id: arc4.UInt64,
        settlement_authority: arc4.Address,
    ) -> None:
        """
        Initialize the GoTag application.

        Admin only.
        Can only be called once.

        payment_asset_id:
            Algorand USDC ASA ID.

        settlement_authority:
            Backend/facilitator settlement address.
        """

        assert (
            Txn.sender.bytes == self.admin.value
        ), "Only admin"

        assert (
            self.initialized.value == UInt64(0)
        ), "Already initialized"

        assert (
            payment_asset_id.native > UInt64(0)
        ), "Invalid payment asset"

        self.payment_asset_id.value = (
            payment_asset_id.native
        )

        self.settlement_authority.value = (
            settlement_authority.native.bytes
        )

        self.initialized.value = UInt64(1)

    # ========================================================
    # SET SETTLEMENT AUTHORITY
    # ========================================================

    @arc4.abimethod()
    def set_settlement_authority(
        self,
        new_authority: arc4.Address,
    ) -> None:
        """
        Change the settlement authority.

        Admin only.
        """

        assert (
            Txn.sender.bytes == self.admin.value
        ), "Only admin"

        self.settlement_authority.value = (
            new_authority.native.bytes
        )

    # ========================================================
    # REGISTER VEHICLE
    # ========================================================

    @arc4.abimethod()
    def register_vehicle(
        self,
        gotag_id: arc4.String,
        owner: arc4.Address,
        spending_limit: arc4.UInt64,
    ) -> None:
        """
        Register a GoTag vehicle.

        Example:

            GoTag:
                GT-AP39-4821

            Spending limit:
                100 USDC

        Amounts use microUSDC.

        1 USDC = 1,000,000 microUSDC
        """

        assert (
            Txn.sender.bytes == self.admin.value
        ), "Only admin"

        assert (
            self.initialized.value == UInt64(1)
        ), "Not initialized"

        assert (
            spending_limit.native > UInt64(0)
        ), "Invalid spending limit"

        # ARC-4 String -> bytes key
        key = gotag_id.bytes

        assert (
            key not in self.vehicles
        ), "Vehicle already registered"

        record = VehicleRecord(
            owner.copy(),
            arc4.UInt64(STATUS_ACTIVE),
            spending_limit,
            arc4.UInt64(0),
        )

        self.vehicles[key] = record.copy()

    # ========================================================
    # BLOCK VEHICLE
    # ========================================================

    @arc4.abimethod()
    def block_vehicle(
        self,
        gotag_id: arc4.String,
    ) -> None:
        """
        Block a vehicle.

        Blocked vehicles cannot create new sessions.

        Admin only.
        """

        assert (
            Txn.sender.bytes == self.admin.value
        ), "Only admin"

        key = gotag_id.bytes

        assert (
            key in self.vehicles
        ), "Vehicle not found"

        vehicle = self.vehicles[key].copy()

        assert (
            vehicle.status.native
            != UInt64(STATUS_BLOCKED)
        ), "Already blocked"

        vehicle.status = arc4.UInt64(
            STATUS_BLOCKED
        )

        self.vehicles[key] = vehicle.copy()

    # ========================================================
    # REGISTER SERVICE
    # ========================================================

    @arc4.abimethod()
    def register_service(
        self,
        service_id: arc4.String,
        provider: arc4.Address,
        service_type: arc4.UInt64,
        price_per_unit: arc4.UInt64,
    ) -> None:
        """
        Register a physical-world service.

        Service types:

            1 = Fuel
            2 = EV Charging
            3 = Parking
            4 = Toll

        price_per_unit uses microUSDC.

        Examples:

            Fuel:
                price per litre

            EV:
                price per kWh

            Parking:
                price per time unit

            Toll:
                fixed price
        """

        assert (
            Txn.sender.bytes == self.admin.value
        ), "Only admin"

        assert (
            self.initialized.value == UInt64(1)
        ), "Not initialized"

        assert (
            service_type.native >= UInt64(1)
        ), "Invalid service type"

        assert (
            service_type.native <= UInt64(4)
        ), "Invalid service type"

        assert (
            price_per_unit.native > UInt64(0)
        ), "Invalid price"

        key = service_id.bytes

        assert (
            key not in self.services
        ), "Service already registered"

        record = ServiceRecord(
            provider.copy(),
            service_type,
            arc4.UInt64(STATUS_ACTIVE),
            price_per_unit,
        )

        self.services[key] = record.copy()

    # ========================================================
    # CREATE SESSION
    # ========================================================

    @arc4.abimethod()
    def create_session(
        self,
        session_id: arc4.String,
        gotag_id: arc4.String,
        service_id: arc4.String,
        amount: arc4.UInt64,
    ) -> None:
        """
        Create a physical service session.

        Example:

            Vehicle:
                GT-AP39-4821

            Service:
                FUEL-STATION-102

            Amount:
                20 USDC

        The caller must be:

            - vehicle owner
            - admin
            - settlement authority
        """

        assert (
            self.initialized.value == UInt64(1)
        ), "Not initialized"

        assert (
            amount.native > UInt64(0)
        ), "Invalid amount"

        # ----------------------------------------------------
        # SESSION ID
        # ----------------------------------------------------

        session_key = session_id.bytes

        assert (
            session_key not in self.sessions
        ), "Session already exists"

        # ----------------------------------------------------
        # VEHICLE
        # ----------------------------------------------------

        vehicle_key = gotag_id.bytes

        assert (
            vehicle_key in self.vehicles
        ), "Vehicle not found"

        vehicle = self.vehicles[
            vehicle_key
        ].copy()

        assert (
            vehicle.status.native
            == UInt64(STATUS_ACTIVE)
        ), "Vehicle not active"

        # ----------------------------------------------------
        # CALLER AUTHORIZATION
        # ----------------------------------------------------

        is_owner = (
            Txn.sender.bytes
            == vehicle.owner.native.bytes
        )

        is_admin = (
            Txn.sender.bytes
            == self.admin.value
        )

        is_settlement_authority = (
            Txn.sender.bytes
            == self.settlement_authority.value
        )

        assert (
            is_owner
            or is_admin
            or is_settlement_authority
        ), "Unauthorized vehicle"

        # ----------------------------------------------------
        # SERVICE
        # ----------------------------------------------------

        service_key = service_id.bytes

        assert (
            service_key in self.services
        ), "Service not found"

        service = self.services[
            service_key
        ].copy()

        assert (
            service.status.native
            == UInt64(STATUS_ACTIVE)
        ), "Service not active"

        # ----------------------------------------------------
        # SPENDING LIMIT
        # ----------------------------------------------------

        remaining_limit = (
            vehicle.spending_limit.native
            - vehicle.spent_amount.native
        )

        assert (
            amount.native <= remaining_limit
        ), "Spending limit exceeded"

        # ----------------------------------------------------
        # CREATE SESSION
        # ----------------------------------------------------

        record = SessionRecord(
            gotag_id,
            service_id,
            arc4.Address(Txn.sender),
            arc4.UInt64(SESSION_PENDING),
            amount,
            arc4.String(""),
        )

        self.sessions[
            session_key
        ] = record.copy()

    # ========================================================
    # CANCEL SESSION
    # ========================================================

    @arc4.abimethod()
    def cancel_session(
        self,
        session_id: arc4.String,
    ) -> None:
        """
        Cancel a pending service session.

        Allowed:

            - vehicle owner
            - admin
            - settlement authority
        """

        session_key = session_id.bytes

        assert (
            session_key in self.sessions
        ), "Session not found"

        session = self.sessions[
            session_key
        ].copy()

        assert (
            session.status.native
            == UInt64(SESSION_PENDING)
        ), "Session is not pending"

        # ----------------------------------------------------
        # VEHICLE
        # ----------------------------------------------------

        vehicle_key = session.gotag_id.bytes

        assert (
            vehicle_key in self.vehicles
        ), "Vehicle not found"

        vehicle = self.vehicles[
            vehicle_key
        ].copy()

        # ----------------------------------------------------
        # AUTHORIZATION
        # ----------------------------------------------------

        is_owner = (
            Txn.sender.bytes
            == vehicle.owner.native.bytes
        )

        is_admin = (
            Txn.sender.bytes
            == self.admin.value
        )

        is_settlement_authority = (
            Txn.sender.bytes
            == self.settlement_authority.value
        )

        assert (
            is_owner
            or is_admin
            or is_settlement_authority
        ), "Unauthorized"

        # ----------------------------------------------------
        # CANCEL
        # ----------------------------------------------------

        session.status = arc4.UInt64(
            SESSION_CANCELLED
        )

        self.sessions[
            session_key
        ] = session.copy()

    # ========================================================
    # RECORD X402 PAYMENT
    # ========================================================

    @arc4.abimethod()
    def record_payment(
        self,
        session_id: arc4.String,
        payment_ref: arc4.String,
    ) -> None:
        """
        Record a successful x402 settlement.

        IMPORTANT:

        This method does not itself perform HTTP x402.

        The off-chain system performs:

            1. Service request
            2. HTTP 402
            3. x402 payment
            4. Facilitator verification
            5. Algorand/USDC settlement
            6. record_payment()

        Only settlement_authority can call this method.
        """

        assert (
            Txn.sender.bytes
            == self.settlement_authority.value
        ), "Only settlement authority"

        assert (
            self.initialized.value == UInt64(1)
        ), "Not initialized"

        # ----------------------------------------------------
        # SESSION
        # ----------------------------------------------------

        session_key = session_id.bytes

        assert (
            session_key in self.sessions
        ), "Session not found"

        session = self.sessions[
            session_key
        ].copy()

        # ----------------------------------------------------
        # DUPLICATE PAYMENT PREVENTION
        # ----------------------------------------------------

        assert (
            session.status.native
            == UInt64(SESSION_PENDING)
        ), "Session already processed"

        # ----------------------------------------------------
        # PAYMENT REFERENCE
        # ----------------------------------------------------

        assert (
            payment_ref.bytes.length
            > UInt64(0)
        ), "Payment reference required"

        # ----------------------------------------------------
        # VEHICLE
        # ----------------------------------------------------

        vehicle_key = session.gotag_id.bytes

        assert (
            vehicle_key in self.vehicles
        ), "Vehicle not found"

        vehicle = self.vehicles[
            vehicle_key
        ].copy()

        assert (
            vehicle.status.native
            == UInt64(STATUS_ACTIVE)
        ), "Vehicle not active"

        # ----------------------------------------------------
        # SPENDING LIMIT
        # ----------------------------------------------------

        new_spent = (
            vehicle.spent_amount.native
            + session.amount.native
        )

        assert (
            new_spent
            <= vehicle.spending_limit.native
        ), "Spending limit exceeded"

        # ----------------------------------------------------
        # UPDATE SPENDING
        # ----------------------------------------------------

        vehicle.spent_amount = arc4.UInt64(
            new_spent
        )

        self.vehicles[
            vehicle_key
        ] = vehicle.copy()

        # ----------------------------------------------------
        # COMPLETE SESSION
        # ----------------------------------------------------

        session.status = arc4.UInt64(
            SESSION_COMPLETED
        )

        # IMPORTANT:
        # payment_ref is an ABI String input.
        # Do NOT call .copy() here because PuyaPy 5.9.0
        # reports that arc4.String has no copy attribute.
        session.payment_ref = payment_ref

        self.sessions[
            session_key
        ] = session.copy()

    # ========================================================
    # GET VEHICLE
    # ========================================================

    @arc4.abimethod(
        readonly=True
    )
    def get_vehicle(
        self,
        gotag_id: arc4.String,
    ) -> VehicleRecord:

        key = gotag_id.bytes

        assert (
            key in self.vehicles
        ), "Vehicle not found"

        return self.vehicles[
            key
        ].copy()

    # ========================================================
    # GET SERVICE
    # ========================================================

    @arc4.abimethod(
        readonly=True
    )
    def get_service(
        self,
        service_id: arc4.String,
    ) -> ServiceRecord:

        key = service_id.bytes

        assert (
            key in self.services
        ), "Service not found"

        return self.services[
            key
        ].copy()

    # ========================================================
    # GET SESSION
    # ========================================================

    @arc4.abimethod(
        readonly=True
    )
    def get_session(
        self,
        session_id: arc4.String,
    ) -> SessionRecord:

        key = session_id.bytes

        assert (
            key in self.sessions
        ), "Session not found"

        return self.sessions[
            key
        ].copy()
