import { useEffect, useMemo, useState, createContext, useContext } from 'react';
import { Link, Route, Routes, useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { PeraWalletConnect } from '@perawallet/connect';
import algosdk from 'algosdk';

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  'http://127.0.0.1:8001'
).replace(/\/$/, '');

const ALGOD_SERVER = (
  import.meta.env.VITE_ALGOD_SERVER ||
  'https://testnet-api.algonode.cloud'
).replace(/\/$/, '');

const DEFAULT_GTUSD_ASSET_ID = Number(
  import.meta.env.VITE_GTUSD_ASSET_ID || '769016907',
);

const DEFAULT_SETTLEMENT_AUTHORITY =
  import.meta.env.VITE_SETTLEMENT_AUTHORITY ||
  '35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM';

const DEFAULT_APP_ID = Number(
  import.meta.env.VITE_APP_ID || '769016959',
);

/*
 * Pera Connect
 * 416002 = Algorand TestNet
 */
const walletConnect =
  typeof window !== 'undefined'
    ? new PeraWalletConnect({
      chainId: 416002,
    })
    : null;

/* -------------------------------------------------------------------------- */
/* Toast Notification System                                                  */
/* -------------------------------------------------------------------------- */

type ToastType = 'success' | 'info' | 'warning' | 'error';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(message: string, type: ToastType = 'info') {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border p-4 shadow-2xl flex items-center justify-between text-xs font-semibold animate-[toastSlideIn_0.3s_ease-out_forwards] ${
              t.type === 'success'
                ? 'border-emerald-500/50 bg-slate-950/95 text-emerald-300 shadow-glow-green'
                : t.type === 'error'
                ? 'border-red-500/50 bg-slate-950/95 text-red-300'
                : t.type === 'warning'
                ? 'border-amber-500/50 bg-slate-950/95 text-amber-300'
                : 'border-cyan-500/50 bg-slate-950/95 text-cyan-300 shadow-glow'
            }`}
          >
            <div className="flex items-center gap-2">
              <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '🛑' : t.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
              <span>{t.message}</span>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-slate-400 hover:text-white ml-3"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast() {
  return useContext(ToastContext);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function ensureAlgorandAddress(
  value: string | null | undefined,
  label: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} address is missing.`);
  }
  if (!algosdk.isValidAddress(trimmed)) {
    throw new Error(`${label} address "${trimmed}" is not a valid Algorand address.`);
  }
  return trimmed;
}

function shortAddress(address: string | null | undefined): string {
  if (!address) return '';
  const trimmed = address.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-6)}`;
}

function formatMicros(amountMicros: number): string {
  return `${(amountMicros / 1_000_000).toFixed(2)} GTUSD`;
}

async function lookupVehicleByGoTag(gotagId: string) {
  const response = await fetch(`${API_BASE}/api/vehicles/${gotagId}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Vehicle not found');
    }
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'Unable to load vehicle.');
  }
  return response.json();
}

function downloadQrPng(elementId: string, filename: string) {
  const svgEl = document.getElementById(elementId) as unknown as SVGSVGElement;
  if (!svgEl) return;
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const canvas = document.createElement('canvas');
  const size = 1024;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);

    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  img.src = url;
}

function printElement(elementId: string) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const printWin = window.open('', '_blank');
  if (!printWin) return;
  printWin.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Print GoTag Pass</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; color: #000; margin: 0; padding: 20px; }
          .print-card { text-align: center; border: 2px solid #000; padding: 32px; border-radius: 24px; max-width: 380px; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .logo { max-width: 80px; margin-bottom: 12px; }
          .title { font-weight: 900; font-size: 24px; letter-spacing: 2px; margin-bottom: 4px; }
          .tagline { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 20px; }
          .qr-box { background: #fff; padding: 16px; display: inline-block; border-radius: 16px; border: 1px solid #ddd; margin-bottom: 20px; }
          .id { font-size: 20px; font-weight: 800; font-family: monospace; letter-spacing: 1px; margin-bottom: 6px; }
          .details { font-size: 14px; color: #444; margin-bottom: 16px; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; background: #e6fffa; color: #007a5e; font-weight: 700; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="print-card">${el.innerHTML}</div>
        <script>window.onload = () => { window.print(); window.close(); };</script>
      </body>
    </html>
  `);
  printWin.document.close();
}

/* -------------------------------------------------------------------------- */
/* Algorand Wallet Transfer (PROTECTED CORE LOGIC - UNCHANGED)                */
/* -------------------------------------------------------------------------- */

async function signGtusdTransfer(
  senderAddress: string,
  amountMicros: bigint,
  noteText: string,
  settlementAuthority: string = DEFAULT_SETTLEMENT_AUTHORITY,
  gtusdAssetId: number = DEFAULT_GTUSD_ASSET_ID,
): Promise<{ tx_id: string; sender: string; receiver: string; amount: number; asset_id: number }> {
  const wc = walletConnect;
  if (!wc) {
    throw new Error('Pera Wallet is not available.');
  }

  const sender = ensureAlgorandAddress(senderAddress, 'Sender');
  const receiver = ensureAlgorandAddress(settlementAuthority, 'Settlement authority');

  const algodClient = new algosdk.Algodv2('', ALGOD_SERVER, '');
  const params = await algodClient.getTransactionParams().do();

  const note = new TextEncoder().encode(noteText || 'GoTag Payment');

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: sender,
    receiver: receiver,
    assetIndex: Number(gtusdAssetId),
    amount: BigInt(amountMicros),
    suggestedParams: params,
    note,
  });

  const signedTxns = await wc.signTransaction([
    [
      {
        txn,
        signers: [sender],
      },
    ],
  ]);

  if (!signedTxns || signedTxns.length === 0) {
    throw new Error('Transaction was cancelled or rejected in Pera Wallet.');
  }

  const sendResult = await algodClient.sendRawTransaction(signedTxns[0]).do();
  const txId = (sendResult as { txid: string; txId?: string }).txid || (sendResult as { txid: string; txId?: string }).txId;

  if (!txId) {
    throw new Error('Failed to obtain Algorand transaction ID after broadcasting.');
  }

  await algosdk.waitForConfirmation(algodClient, txId, 4);

  return {
    tx_id: txId,
    sender,
    receiver,
    amount: Number(amountMicros),
    asset_id: gtusdAssetId,
  };
}

/* -------------------------------------------------------------------------- */
/* SERVICES CATALOG                                                           */
/* -------------------------------------------------------------------------- */

const SERVICE_CATALOG = [
  {
    id: 'FUEL-001',
    label: 'FUEL',
    price: 10400000,
    desc: 'Fuel Station #01',
    slug: 'fuel',
    icon: '⛽',
    m2mLabel: 'Usage-based pricing (Litres)',
    unitRate: '2.00 GTUSD / L',
    defaultQty: '5.2',
    unit: 'L',
    color: 'from-amber-500/20 to-orange-500/10 border-amber-500/40 text-amber-300',
  },
  {
    id: 'EV-001',
    label: 'EV CHARGING',
    price: 2100000,
    desc: 'EV Charger #17',
    slug: 'ev',
    icon: '⚡',
    m2mLabel: 'Energy consumption (kWh)',
    unitRate: '0.25 GTUSD / kWh',
    defaultQty: '8.4',
    unit: 'kWh',
    color: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/40 text-cyan-300',
  },
  {
    id: 'TOLL-001',
    label: 'TOLL',
    price: 8000000,
    desc: 'Toll Gate #01',
    slug: 'toll',
    icon: '🚗',
    m2mLabel: 'FASTag-style automatic toll',
    unitRate: 'Car rate 8.00 GTUSD',
    defaultQty: '1',
    unit: 'pass',
    color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300',
  },
  {
    id: 'PARK-001',
    label: 'PARKING',
    price: 1500000,
    desc: 'Parking Zone A',
    slug: 'parking',
    icon: '🅿️',
    m2mLabel: 'Pay by duration (Time-based)',
    unitRate: '0.50 GTUSD / hour',
    defaultQty: '1',
    unit: 'session',
    color: 'from-purple-500/20 to-indigo-500/10 border-purple-500/40 text-purple-300',
  },
];

function getServiceById(serviceId: string) {
  return (
    SERVICE_CATALOG.find((s) => s.id === serviceId) ||
    SERVICE_CATALOG.find((s) => s.slug === serviceId) ||
    SERVICE_CATALOG[0]
  );
}

const DEMO_VEHICLE = {
  gotag_id: 'GT-AP39-0001',
  plate_number: 'AP39XX1234',
  owner_name: 'Venky',
  owner_wallet: DEFAULT_SETTLEMENT_AUTHORITY,
  vehicle_type: 'Car',
  status: 'ACTIVE',
  spending_limit: 100000000,
  available_balance: 100000000,
  spent_amount: 0,
};

/* -------------------------------------------------------------------------- */
/* REUSABLE UI PRIMITIVES                                                     */
/* -------------------------------------------------------------------------- */

function BarrierGateAnimation({ isOpen, label }: { isOpen: boolean; label?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 text-center space-y-4 shadow-2xl">
      <div className="text-xs font-bold uppercase tracking-widest text-cyan-400">
        {isOpen ? '🟢 Barrier Gate: OPEN' : '🔴 Barrier Gate: CLOSED'}
      </div>

      <div className="relative h-28 w-full bg-slate-900/80 rounded-xl border border-slate-800 flex items-end justify-center overflow-hidden">
        {/* Support Pillar */}
        <div className="absolute left-8 bottom-0 h-20 w-8 bg-slate-700 rounded-t-lg border-2 border-slate-600 z-20 flex items-center justify-center">
          <div className={`h-3.5 w-3.5 rounded-full ${isOpen ? 'bg-emerald-400 animate-ping' : 'bg-red-500'}`} />
        </div>

        {/* Barrier Arm */}
        <div
          className={`absolute left-11 bottom-14 h-3.5 w-56 rounded-r-full bg-gradient-to-r from-amber-500 via-red-500 to-amber-500 shadow-glow border border-amber-300 origin-left transition-transform duration-1000 ${
            isOpen ? '-rotate-[75deg]' : 'rotate-0'
          }`}
        />

        {/* Road Stripes */}
        <div className="w-full h-3 bg-slate-800 flex justify-around items-center">
          <div className="w-10 h-full bg-amber-400/40" />
          <div className="w-10 h-full bg-amber-400/40" />
          <div className="w-10 h-full bg-amber-400/40" />
        </div>
      </div>

      {label && <div className="text-xs font-bold text-emerald-400 animate-pulse">{label}</div>}
    </div>
  );
}

function ConnectedVehicleVisual({ vehicle }: { vehicle: any }) {
  if (!vehicle) return null;
  return (
    <div className="relative rounded-2xl border border-slate-800 bg-[#070d18] p-5 shadow-2xl overflow-hidden group transition-all duration-300 hover:border-cyan-500/50 hover:shadow-glow flex flex-col justify-between min-h-[220px]">
      <div className="absolute inset-0 bg-gradient-to-tr from-cyan-950/20 via-transparent to-emerald-950/20 pointer-events-none" />

      <div className="flex items-center justify-between z-10">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">CONNECTED VEHICLE IDENTITY</div>
          <div className="text-base font-black text-white font-mono tracking-wide flex items-center gap-1.5 mt-0.5">
            {vehicle.gotag_id}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="badge badge-active text-[10px] px-2.5 py-0.5 font-bold shadow-glow-green">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            {vehicle.status || 'ACTIVE'}
          </span>
        </div>
      </div>

      <div className="relative my-2 py-3 flex items-center justify-center">
        <div className="absolute h-36 w-36 rounded-full border border-cyan-500/20 animate-[pulseGlow_4s_ease-in-out_infinite]" />
        <div className="absolute h-24 w-24 rounded-full border border-emerald-500/30 animate-[pulseGlow_2.5s_ease-in-out_infinite]" />

        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 280 100" fill="none">
          <path d="M40 50 L 100 50" stroke="#1e293b" strokeWidth="1.5" strokeDasharray="3 3" />
          <path d="M180 50 L 240 50" stroke="#1e293b" strokeWidth="1.5" strokeDasharray="3 3" />
          
          <path d="M40 50 L 100 50" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="4 4" className="animate-[flowParticles_3s_linear_infinite]" />
          <path d="M180 50 L 240 50" stroke="#00d084" strokeWidth="1.5" strokeDasharray="4 4" className="animate-[flowParticles_2.5s_linear_infinite]" />

          <circle cx="40" cy="50" r="3" fill="#06b6d4" />
          <circle cx="240" cy="50" r="3" fill="#00d084" />
        </svg>

        <div className="absolute left-1 top-2 text-[9px] font-mono font-bold text-slate-400 bg-slate-950/80 px-2 py-1 rounded-md border border-slate-800 z-10 hidden sm:block">
          x402 READY
        </div>

        <div className="absolute right-1 bottom-2 text-[9px] font-mono font-bold text-emerald-400 bg-slate-950/80 px-2 py-1 rounded-md border border-slate-800 z-10 hidden sm:block">
          ALGORAND TESTNET
        </div>

        <div className="relative z-10 group-hover:scale-105 transition-transform duration-300">
          <svg width="68" height="110" viewBox="0 0 68 110" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_0_15px_rgba(6,182,212,0.4)]">
            <path
              d="M34 4 C18 4 10 18 10 34 L10 76 C10 92 18 106 34 106 C50 106 58 92 58 76 L58 34 C58 18 50 4 34 4 Z"
              fill="#0f172a"
              stroke="#06b6d4"
              strokeWidth="2"
            />
            <path
              d="M34 20 C24 20 18 26 18 36 L18 64 C18 72 24 78 34 78 C44 78 50 72 50 64 L50 36 C50 26 44 20 34 20 Z"
              fill="#1e293b"
              stroke="#00d084"
              strokeWidth="1.5"
            />
            <path d="M26 42 L42 42 L40 58 L28 58 Z" fill="#0f172a" stroke="#334155" strokeWidth="1" />
            <path d="M14 12 L24 10" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M54 12 L44 10" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M16 98 L24 99" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M52 98 L44 99" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="34" cy="50" r="4" fill="#00d084" className="animate-pulse" />
          </svg>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 z-10 border-t border-slate-900 pt-2.5">
        <div>Plate: <strong className="text-white font-bold">{vehicle.plate_number}</strong></div>
        <div>Type: <strong className="text-cyan-300 font-bold">{vehicle.vehicle_type || 'Car'}</strong></div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GTUSD TOP-UP MODAL (WITH LORA LINK & BALANCE REFRESH)                     */
/* -------------------------------------------------------------------------- */

function TopUpModal({
  isOpen,
  onClose,
  gotagId,
  currentBalance,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  gotagId: string;
  currentBalance: number;
  onSuccess: (newBalance: number) => void;
}) {
  const { showToast } = useToast();
  const [selectedAmount, setSelectedAmount] = useState<number>(50);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [funding, setFunding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [topupSuccessData, setTopupSuccessData] = useState<any>(null);

  if (!isOpen) return null;

  const effectiveAmount = customAmount ? parseFloat(customAmount) : selectedAmount;

  async function handleRefreshBalance() {
    setRefreshing(true);
    try {
      if (gotagId) {
        const res = await fetch(`${API_BASE}/api/vehicles/${gotagId}`);
        if (res.ok) {
          const data = await res.json();
          const updatedBal = data.available_balance ? data.available_balance / 1_000_000 : currentBalance;
          onSuccess(updatedBal);
          showToast(`Balance refreshed: ${updatedBal.toFixed(2)} GTUSD`, 'success');
          setRefreshing(false);
          return;
        }
      }
      showToast('Balance refresh complete', 'info');
    } catch {
      showToast('Balance refresh complete', 'info');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleTopUp() {
    if (!gotagId) {
      setError('Please register a GoTag identity for this wallet before funding.');
      return;
    }

    if (!effectiveAmount || effectiveAmount <= 0 || isNaN(effectiveAmount)) {
      setError('Enter a valid top-up amount.');
      return;
    }

    setFunding(true);
    setError('');
    setTopupSuccessData(null);

    try {
      const amountMicros = Math.round(effectiveAmount * 1_000_000);
      const res = await fetch(`${API_BASE}/api/wallet/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gotag_id: gotagId,
          amount: amountMicros,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'TestNet GTUSD top-up failed.');
      }

      setTopupSuccessData(data);
      const updatedBal = data.available_balance ? data.available_balance / 1_000_000 : currentBalance + effectiveAmount;
      onSuccess(updatedBal);
      showToast(`TestNet GTUSD Top-Up of +${effectiveAmount.toFixed(2)} GTUSD confirmed!`, 'success');
    } catch (err: any) {
      setError(err.message || 'TestNet GTUSD top-up failed.');
    } finally {
      setFunding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in overflow-y-auto">
      <div className="card max-w-xl w-full p-6 space-y-6 relative border-cyan-500/50 shadow-glow my-8">
        {/* Modal Header with Back Arrow & Official Logo */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 hover:border-slate-700 hover:text-white transition shadow-sm"
              title="Return to Dashboard"
            >
              <span className="text-sm font-black">&larr;</span>
              <span className="hidden sm:inline">Back to Dashboard</span>
            </button>
            <img src="/gotag-logo.png" alt="GoTag" className="h-10 w-10 object-contain rounded-xl border border-slate-800 bg-slate-950 p-1" />
            <div>
              <div className="flex items-center gap-2">
                <span className="badge badge-active text-[10px] py-0">● Algorand TestNet</span>
                <span className="text-xs font-mono text-cyan-400 font-bold">ASA #769016907</span>
              </div>
              <h2 className="text-xl font-black text-white mt-0.5">TOP UP GTUSD</h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold p-1"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Guidance Banner */}
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 space-y-1 text-xs">
          <div className="font-bold text-white text-sm">Need GTUSD for GoTag services?</div>
          <p className="text-slate-300 leading-relaxed">
            GTUSD is the payment asset used by GoTag for <strong>Fuel</strong>, <strong>EV</strong>, <strong>Toll</strong> and <strong>Parking</strong> machine services.
          </p>
        </div>

        {topupSuccessData ? (
          <div className="space-y-4 text-center animate-fade-in">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-2xl border border-emerald-500/60 shadow-glow-green">
              ✓
            </div>

            <div>
              <div className="text-xs text-slate-400 uppercase font-bold">Top Up Successful</div>
              <div className="text-3xl font-black text-emerald-400 font-mono mt-1">
                +{(topupSuccessData.amount_gtusd || 0).toFixed(2)} GTUSD
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs font-mono text-left space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Transaction Ref</span>
                <span className="text-cyan-300 font-bold">{topupSuccessData.payment_ref}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Asset</span>
                <span className="text-slate-200">GTUSD ASA #769016907</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Network</span>
                <span className="text-emerald-400 font-bold">Algorand TestNet</span>
              </div>
              <div className="flex justify-between border-t border-slate-900 pt-2">
                <span className="text-slate-400">New Available Balance</span>
                <span className="text-white font-bold">{((topupSuccessData.available_balance || 0) / 1_000_000).toFixed(2)} GTUSD</span>
              </div>
            </div>

            <button onClick={onClose} className="btn-primary w-full py-3 text-sm">
              Done &amp; Close
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Current Balance Display with Refresh Button */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Available GTUSD Balance</span>
                <div className="text-3xl font-black text-white font-mono mt-0.5">
                  {currentBalance.toFixed(2)} <span className="text-base font-bold text-cyan-300">GTUSD</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRefreshBalance}
                disabled={refreshing}
                className="btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5"
              >
                <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
                <span>{refreshing ? 'Refreshing...' : 'Refresh Balance'}</span>
              </button>
            </div>

            {/* Official Algorand LORA Option */}
            <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-slate-950 to-slate-950 p-5 space-y-3 shadow-glow-green">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🌐</span>
                  <h3 className="font-bold text-white text-base">GET GTUSD ON LORA</h3>
                </div>
                <span className="badge badge-active text-[10px] font-bold">Algorand AlgoKit LORA</span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Open the official Algorand LORA TestNet interface to acquire/fund TestNet assets and inspect transactions on-chain.
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href="https://lora.algokit.io/testnet/asset/769016907"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-green text-xs py-2.5 px-4 font-bold flex items-center gap-1.5 shadow-glow-green"
                >
                  <span>Open LORA ↗</span>
                </a>

                <a
                  href="https://testnet.explorer.perawallet.app/asset/769016907"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs py-2.5 px-4 font-bold flex items-center gap-1.5"
                >
                  <span>View GTUSD Asset ↗</span>
                </a>
              </div>
            </div>

            {/* Quick TestNet Faucet Micro-Fund */}
            <div className="space-y-4 border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">TestNet GTUSD Faucet</span>
                <span className="text-[10px] text-slate-400 font-mono">ASA #769016907</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[10, 25, 50, 100].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setSelectedAmount(amt);
                      setCustomAmount('');
                    }}
                    className={`py-3 rounded-xl font-bold font-mono text-sm transition-all ${
                      selectedAmount === amt && !customAmount
                        ? 'bg-cyan-500 text-slate-950 shadow-glow'
                        : 'border border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {amt} GTUSD
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <input
                  type="number"
                  min="1"
                  max="500"
                  placeholder="Or custom amount (e.g. 75)"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="input-field font-mono font-bold text-cyan-300"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200 font-bold">
                  🛑 {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3 text-xs">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleTopUp}
                  disabled={funding}
                  className="btn-primary flex-1 py-3 text-sm font-bold"
                >
                  {funding ? 'Funding TestNet GTUSD...' : `💰 Request +${effectiveAmount.toFixed(2)} GTUSD`}
                </button>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 font-mono text-center border-t border-slate-900 pt-3 italic">
              ℹ️ TestNet GTUSD is strictly for machine mobility testing on Algorand TestNet and holds no real monetary value.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WALLET ASSET DETAILS DRAWER                                                */
/* -------------------------------------------------------------------------- */

function WalletAssetDrawer({
  isOpen,
  onClose,
  walletAddress,
  walletBalance,
  onOpenTopUp,
}: {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  walletBalance: number;
  onOpenTopUp: () => void;
}) {
  const { showToast } = useToast();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="card h-full max-w-md w-full p-6 space-y-6 rounded-none border-l border-slate-800 bg-[#070e1c] shadow-2xl flex flex-col justify-between">
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <img src="/gotag-logo.png" alt="GoTag" className="h-10 w-10 object-contain rounded-xl border border-slate-800 bg-slate-950 p-1" />
              <div>
                <h3 className="text-lg font-black text-white">GTUSD Wallet Asset</h3>
                <span className="text-xs text-slate-400 font-mono">Algorand ASA #769016907</span>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg">
              ✕
            </button>
          </div>

          <div className="rounded-2xl border border-cyan-500/40 bg-slate-950 p-6 text-center space-y-2 shadow-glow">
            <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">Available GTUSD Balance</div>
            <div className="text-4xl font-black text-white font-mono">{walletBalance.toFixed(2)}</div>
            <div className="text-xs text-emerald-400 font-bold">● Algorand TestNet ASA</div>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div className="flex justify-between border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">Connected Wallet</span>
              <span className="text-cyan-300 font-bold">{shortAddress(walletAddress) || 'Not Connected'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">Asset Name</span>
              <span className="text-white font-bold">GoTag USD (GTUSD)</span>
            </div>
            <div className="flex justify-between border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">Asset ID</span>
              <span className="text-cyan-400 font-bold">769016907</span>
            </div>
            <div className="flex justify-between border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">App ID</span>
              <span className="text-cyan-400 font-bold">769016959</span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-slate-400">Settlement Authority</span>
              <span className="text-slate-200 font-bold">35VTBJ...FZNWFM</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => {
              onClose();
              onOpenTopUp();
            }}
            className="btn-green w-full py-3.5 text-sm font-bold"
          >
            💰 Top Up GTUSD Balance
          </button>
          <a
            href="https://lora.algokit.io/testnet/asset/769016907"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary w-full py-3 text-xs text-center flex items-center justify-center gap-1.5"
          >
            <span>Open LORA TestNet ↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DASHBOARD PAGE                                                             */
/* -------------------------------------------------------------------------- */

function DashboardPage({
  walletAddress,
  walletBalance,
  walletVehicle,
  walletTransactions,
  identityRegistered,
  onUpdateBalance,
  onRefreshData,
}: {
  walletAddress: string;
  walletBalance: number;
  walletVehicle: any;
  walletTransactions: any[];
  identityRegistered: boolean | null;
  onUpdateBalance: (newBal: number) => void;
  onRefreshData: () => void;
}) {
  const [showQrModal, setShowQrModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showWalletDrawer, setShowWalletDrawer] = useState(false);
  const { showToast } = useToast();

  const vehicle = walletVehicle;
  const transactions = walletTransactions;

  // Unconnected / Visitor Demo State
  if (!walletAddress) {
    return (
      <div className="max-w-4xl mx-auto space-y-8 animate-fade-in py-6">
        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-[#0c1425] to-slate-950 p-8 shadow-card text-center space-y-6">
          <img src="/gotag-logo.png" alt="GoTag" className="h-16 w-16 mx-auto object-contain drop-shadow-[0_0_15px_rgba(6,182,212,0.4)]" />

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              Machine Mobility Identity
            </div>
            <h1 className="text-4xl font-black text-white sm:text-5xl">GoTag Web3 Mobility Pass</h1>
            <p className="text-base text-slate-300 max-w-xl mx-auto font-medium">
              "One Pass. Every Road." Autonomous vehicle identity + x402 machine payments on Algorand.
            </p>
          </div>

          <div className="rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-6 max-w-md mx-auto space-y-3 text-left text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Wallet Status</span>
              <span className="text-amber-400 font-bold">Connect Pera Wallet to Access</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GTUSD Asset</span>
              <span className="text-cyan-300 font-bold">ASA #769016907</span>
            </div>
            <div className="flex justify-between border-t border-slate-900 pt-2">
              <span className="text-slate-400">Network</span>
              <span className="text-emerald-400 font-bold">Algorand TestNet</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-md mx-auto">
            <Link to="/register" className="btn-primary text-xs py-3.5 px-6 font-bold shadow-glow text-center flex-1">
              🆔 Register Vehicle Identity
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Connected Wallet with NO Registered Vehicle:
  if (walletAddress && identityRegistered === false) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 animate-fade-in py-8">
        <div className="card p-8 text-center space-y-6 border-slate-800 bg-[#070e1c] shadow-2xl">
          <img src="/gotag-logo.png" alt="GoTag" className="h-16 w-16 mx-auto object-contain drop-shadow-[0_0_15px_rgba(6,182,212,0.3)]" />

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              No Vehicle Identity Registered
            </div>
            <h1 className="text-3xl font-black text-white">Welcome to GoTag</h1>
            <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
              The connected Pera wallet <span className="font-mono text-cyan-300 font-bold">{shortAddress(walletAddress)}</span> does not have a registered GoTag vehicle identity yet.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 max-w-md mx-auto space-y-3 text-xs font-mono text-left">
            <div className="flex justify-between">
              <span className="text-slate-400">Connected Wallet</span>
              <span className="text-emerald-300 font-bold">{shortAddress(walletAddress)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GTUSD Balance</span>
              <span className="text-cyan-300 font-bold">{walletBalance.toFixed(2)} GTUSD</span>
            </div>
            <div className="flex justify-between border-t border-slate-900 pt-2">
              <span className="text-slate-400">Network</span>
              <span className="text-emerald-400 font-bold">Algorand TestNet</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-md mx-auto">
            <Link to="/register" className="btn-primary text-xs py-3.5 px-6 font-bold shadow-glow text-center flex-1">
              🆔 Register GoTag Identity
            </Link>
            <button onClick={() => setShowTopUpModal(true)} className="btn-secondary text-xs py-3.5 px-6 flex-1">
              💰 Top Up GTUSD
            </button>
          </div>
        </div>

        {/* Global TopUpModal */}
        <TopUpModal
          isOpen={showTopUpModal}
          onClose={() => {
            setShowTopUpModal(false);
            onRefreshData();
          }}
          gotagId=""
          currentBalance={walletBalance}
          onSuccess={(newBal) => {
            onUpdateBalance(newBal);
            onRefreshData();
          }}
        />
      </div>
    );
  }

  // Loading Vehicle Identity
  if (!vehicle) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16 space-y-4">
        <img src="/gotag-logo.png" alt="GoTag" className="h-12 w-12 mx-auto animate-pulse" />
        <div className="text-sm font-bold text-slate-400">Loading wallet identity &amp; vehicle pass...</div>
      </div>
    );
  }

  const activeWallet = walletAddress || vehicle.owner_wallet;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Visual Identity Banner with Official Logo */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-[#0c1425] to-slate-950 p-8 shadow-card">
        <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -left-16 -bottom-16 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative z-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-center">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img src="/gotag-logo.png" alt="GoTag" className="h-10 w-10 object-contain rounded-xl border border-cyan-500/30 bg-slate-950 p-1" />
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                Machine Mobility Identity
              </div>
            </div>

            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              GoTag <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">Pass</span>
            </h1>

            <p className="text-base font-semibold text-slate-300">
              "One Pass. Every Road."
            </p>

            <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
              Autonomous vehicle identity + machine-to-machine payment identity powered by <span className="font-semibold text-cyan-300">x402 protocol</span> &amp; <span className="font-semibold text-emerald-400">Algorand TestNet</span> GTUSD micro-settlements.
            </p>
          </div>

          {/* Connected Vehicle Visual */}
          <ConnectedVehicleVisual vehicle={vehicle} />
        </div>
      </div>

      {/* Vehicle Identity & Wallet Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Vehicle Identity Card */}
        <div className="card-hover p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Vehicle Identity</span>
            <span className="badge badge-active font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {vehicle.status || 'ACTIVE'}
            </span>
          </div>

          <div>
            <div className="text-2xl font-black text-white font-mono">{vehicle.gotag_id}</div>
            <div className="text-sm font-semibold text-cyan-300 mt-0.5">Plate: {vehicle.plate_number}</div>
          </div>

          <button
            onClick={() => setShowQrModal(true)}
            className="btn-secondary text-xs w-full py-2"
          >
            📷 Show QR Pass
          </button>
        </div>

        {/* Wallet Address Card */}
        <div className="card-hover p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Connected Wallet</span>
            <span className="badge badge-cyan font-bold">Pera TestNet</span>
          </div>

          <div>
            <div className="text-xs font-mono text-cyan-300 break-all bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
              {shortAddress(activeWallet) || 'Not Connected'}
            </div>
          </div>

          <div className="text-xs text-slate-400 border-t border-slate-800 pt-3 flex justify-between">
            <span>Network</span>
            <span className="font-semibold text-emerald-400">Algorand 416002</span>
          </div>
        </div>

        {/* Balance Card with Top Up Action */}
        <div className="card-hover p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">GTUSD Balance</span>
            <span className="text-xs font-mono text-cyan-400">ASA #769016907</span>
          </div>

          <div>
            <div className="text-3xl font-black text-white font-mono">{walletBalance.toFixed(2)} <span className="text-lg font-bold text-cyan-300">GTUSD</span></div>
            <div className="text-xs text-slate-400 mt-1">Algorand TestNet ASA</div>
          </div>

          <div className="flex gap-2 border-t border-slate-800 pt-3">
            <button
              onClick={() => setShowTopUpModal(true)}
              className="btn-green text-xs flex-1 py-2 font-bold shadow-glow-green"
            >
              💰 Top Up
            </button>
            <button
              onClick={() => setShowWalletDrawer(true)}
              className="btn-secondary text-xs flex-1 py-2"
            >
              Asset Info
            </button>
          </div>
        </div>

        {/* Available Budget Card */}
        <div className="card-hover p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Available Budget</span>
            <span className="badge border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold">Ready</span>
          </div>

          <div>
            <div className="text-3xl font-black text-emerald-400 font-mono">
              {formatMicros(vehicle.available_balance ?? vehicle.spending_limit ?? 100000000)}
            </div>
            <div className="text-xs text-slate-400 mt-1">Autonomous Service Budget</div>
          </div>

          <div className="text-xs text-slate-400 border-t border-slate-800 pt-3 flex justify-between">
            <span>Status</span>
            <span className="font-semibold text-emerald-400">Verified &amp; Active</span>
          </div>
        </div>
      </div>

      {/* Services Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>Mobility Services</span>
            <span className="badge badge-cyan">x402 Enabled</span>
          </h2>
          <Link to="/scan" className="text-xs font-bold text-cyan-400 hover:underline flex items-center gap-1">
            Scan GoTag to Pay ↗
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {SERVICE_CATALOG.map((s) => (
            <Link
              key={s.id}
              to={`/service/${s.id}?gotag_id=${vehicle.gotag_id}`}
              className="card-hover p-6 space-y-4 group relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-4xl group-hover:scale-110 transition-transform">{s.icon}</span>
                <span className={`badge border ${s.color}`}>
                  {s.label}
                </span>
              </div>

              <div>
                <h3 className="font-bold text-white text-lg group-hover:text-cyan-300 transition-colors">
                  {s.desc}
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.m2mLabel}</p>
              </div>

              <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Rate:</span>
                <span className="font-bold text-cyan-300">{s.unitRate}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Transactions Card List */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Recent Transactions</h2>
          <Link to="/transactions" className="text-xs font-bold text-cyan-400 hover:underline">
            View All ({transactions.length}) ↗
          </Link>
        </div>

        {transactions.length ? (
          <div className="space-y-3">
            {transactions.slice(0, 5).map((tx, idx) => {
              const isTopUp = tx.service_type === 'TOPUP';
              return (
                <div
                  key={tx.transaction_id || idx}
                  className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-slate-700"
                >
                  <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border text-2xl ${
                      isTopUp ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-cyan-500/10 border-cyan-500/30'
                    }`}>
                      {isTopUp ? '💰' : tx.service_type === 'FUEL' ? '⛽' : tx.service_type === 'EV' ? '⚡' : tx.service_type === 'TOLL' ? '🚗' : '🅿️'}
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm">
                        {isTopUp ? 'GTUSD TOP UP' : tx.service_type} • <span className="font-mono text-cyan-300 text-xs">{tx.gotag_id}</span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">Ref: {tx.session_id}</div>
                    </div>
                  </div>

                  <div className="text-right space-y-1">
                    <div className={`font-bold font-mono text-base ${isTopUp ? 'text-emerald-400' : 'text-cyan-300'}`}>
                      {isTopUp ? `+${(tx.amount / 1000000).toFixed(2)} GTUSD` : formatMicros(tx.amount)}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <span className={`badge text-[10px] py-0 ${isTopUp ? 'badge-active' : 'badge-cyan'}`}>{tx.status}</span>
                      {(tx.algorand_tx_id || (tx.payment_ref && tx.payment_ref.length > 10)) && (
                        <span className="text-[11px] font-mono text-slate-400">
                          {(tx.algorand_tx_id || tx.payment_ref).slice(0, 8)}...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500 text-sm">
            No transactions recorded yet for this wallet. Scan a GoTag to initiate an x402 payment.
          </div>
        )}
      </div>

      {/* QR Modal View */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="card max-w-sm w-full p-6 text-center space-y-6 relative border-cyan-500/50 shadow-glow">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white text-lg font-bold"
            >
              ✕
            </button>

            <div className="space-y-1">
              <img src="/gotag-logo.png" alt="GoTag" className="h-10 w-10 mx-auto object-contain" />
              <div className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">GoTag Identity Pass</div>
              <div className="text-xl font-bold text-white">{vehicle.gotag_id}</div>
            </div>

            <div className="inline-block rounded-2xl bg-white p-4 shadow-2xl border border-slate-200">
              <QRCodeSVG
                id="modal-qr-svg"
                value={JSON.stringify({ type: 'gotag', gotag_id: vehicle.gotag_id })}
                size={220}
                level="H"
                includeMargin={true}
              />
            </div>

            <div className="text-xs text-slate-400">
              Vehicle: <strong className="text-white">{vehicle.plate_number}</strong> • Status: <strong className="text-emerald-400">ACTIVE</strong>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  downloadQrPng('modal-qr-svg', `gotag-${vehicle.gotag_id}.png`);
                  showToast('GoTag QR code downloaded!', 'success');
                }}
                className="btn-primary text-xs flex-1"
              >
                📥 Download
              </button>
              <button onClick={() => setShowQrModal(false)} className="btn-secondary text-xs flex-1">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GTUSD Top Up Modal */}
      <TopUpModal
        isOpen={showTopUpModal}
        onClose={() => {
          setShowTopUpModal(false);
          onRefreshData();
        }}
        gotagId={vehicle.gotag_id}
        currentBalance={walletBalance}
        onSuccess={(newBal) => {
          onUpdateBalance(newBal);
          onRefreshData();
        }}
      />

      {/* Wallet Asset Info Drawer */}
      <WalletAssetDrawer
        isOpen={showWalletDrawer}
        onClose={() => setShowWalletDrawer(false)}
        walletAddress={activeWallet}
        walletBalance={walletBalance}
        onOpenTopUp={() => setShowTopUpModal(true)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* REGISTRATION PAGE                                                          */
/* -------------------------------------------------------------------------- */

function RegistrationPage({ walletAddress, onRegistrationSuccess }: { walletAddress: string; onRegistrationSuccess?: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState({
    plate_number: 'AP39XX5678',
    owner_name: 'Alex Rivera',
    owner_wallet: walletAddress || DEFAULT_SETTLEMENT_AUTHORITY,
    vehicle_type: 'Car',
    spending_limit: '100',
  });

  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm((curr) => ({
      ...curr,
      owner_wallet: walletAddress || curr.owner_wallet,
    }));
  }, [walletAddress]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStep(3);

    try {
      const response = await fetch(`${API_BASE}/api/vehicles/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_wallet: walletAddress || form.owner_wallet,
          spending_limit: Number(form.spending_limit) * 1_000_000,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Registration failed.');
      }

      setResult(data);
      setStep(4);
      if (onRegistrationSuccess) onRegistrationSuccess();
      showToast('GoTag vehicle identity registered!', 'success');
    } catch (err: any) {
      setError(err.message || 'Unable to register vehicle.');
      setStep(1);
    } finally {
      setLoading(false);
    }
  }

  const qrPayload = useMemo(() => {
    if (!result?.gotag_id) return '';
    return JSON.stringify({ type: 'gotag', gotag_id: result.gotag_id });
  }, [result]);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <img src="/gotag-logo.png" alt="GoTag" className="h-12 w-12 mx-auto object-contain" />
        <h1 className="text-3xl font-black text-white">Vehicle Identity Registration</h1>
        <p className="text-sm text-slate-400">Generate a unique GoTag ID &amp; scannable QR Pass for x402 payments.</p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { num: 1, label: '1. Details' },
          { num: 2, label: '2. Wallet' },
          { num: 3, label: '3. Create' },
          { num: 4, label: '4. Pass Ready' },
        ].map((s) => (
          <div
            key={s.num}
            className={`rounded-xl border p-3 text-center text-xs font-bold transition-all ${
              step === s.num
                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-glow'
                : step > s.num
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-800 bg-slate-950 text-slate-500'
            }`}
          >
            {step > s.num ? `✓ ${s.label}` : s.label}
          </div>
        ))}
      </div>

      <div className="card p-8">
        {step === 1 && (
          <form onSubmit={() => setStep(2)} className="space-y-6">
            <h2 className="text-xl font-bold text-white border-b border-slate-800 pb-3">Step 1: Vehicle &amp; Owner Details</h2>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Vehicle Plate Number</label>
                <input
                  value={form.plate_number}
                  onChange={(e) => setForm({ ...form, plate_number: e.target.value.toUpperCase() })}
                  placeholder="AP39XX5678"
                  required
                  className="input-field uppercase font-mono font-bold"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Vehicle Type</label>
                <select
                  value={form.vehicle_type}
                  onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
                  className="input-field bg-slate-950"
                >
                  <option value="Car">Car / Sedan</option>
                  <option value="SUV">SUV / Crossover</option>
                  <option value="EV">Electric Vehicle (EV)</option>
                  <option value="Motorcycle">Motorcycle</option>
                  <option value="Truck">Commercial Truck</option>
                </select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Owner Name</label>
                <input
                  value={form.owner_name}
                  onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                  placeholder="Full Name"
                  required
                  className="input-field"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Spending Limit (GTUSD)</label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={form.spending_limit}
                  onChange={(e) => setForm({ ...form, spending_limit: e.target.value })}
                  required
                  className="input-field font-mono font-bold text-cyan-300"
                />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full text-base py-3.5">
              Continue to Step 2: Wallet &rarr;
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white border-b border-slate-800 pb-3">Step 2: Connect Owner Wallet</h2>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-300">Wallet Address</span>
                <span className="badge badge-cyan">{walletAddress ? 'Connected' : 'Default Authority'}</span>
              </div>

              <input
                value={walletAddress || form.owner_wallet}
                onChange={(e) => setForm({ ...form, owner_wallet: e.target.value })}
                className="input-field font-mono text-xs"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 font-bold">
                🛑 {error}
              </div>
            )}

            <div className="flex gap-4">
              <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1">
                &larr; Back
              </button>
              <button type="button" onClick={handleSubmit} className="btn-green flex-1 text-base py-3.5">
                Create GoTag Identity &rarr;
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="py-12 text-center space-y-4">
            <img src="/gotag-logo.png" alt="GoTag" className="h-12 w-12 mx-auto animate-pulse" />
            <h2 className="text-2xl font-bold text-white">Registering Vehicle on Algorand...</h2>
            <p className="text-sm text-slate-400">Generating unique GoTag ID and scannable QR Pass payload...</p>
          </div>
        )}

        {step === 4 && result && (
          <div className="space-y-6 animate-fade-in text-center">
            <img src="/gotag-logo.png" alt="GoTag" className="h-14 w-14 mx-auto object-contain drop-shadow-[0_0_12px_rgba(0,208,132,0.4)]" />

            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-center space-y-1">
              <div className="text-xs font-bold uppercase tracking-widest text-emerald-400">✓ GO TAG CREATED</div>
              <p className="text-sm text-emerald-200 font-semibold">Your vehicle identity is ready for x402 machine payments.</p>
            </div>

            <div
              id="gotag-printable-card"
              className="card p-8 bg-gradient-to-b from-slate-900 to-slate-950 border-cyan-500/40 shadow-glow text-center space-y-6 max-w-md mx-auto"
            >
              <div className="flex items-center justify-center gap-3">
                <img src="/gotag-logo.png" alt="GoTag Logo" className="h-10 w-10 object-contain" />
                <div className="text-left">
                  <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-400">GoTag Pass</div>
                  <div className="text-sm font-bold text-white">One Pass. Every Road.</div>
                </div>
              </div>

              <div className="inline-block rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
                <QRCodeSVG
                  id="gotag-qr-svg"
                  value={qrPayload}
                  size={240}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="space-y-1">
                <div className="text-3xl font-black text-cyan-300 font-mono tracking-wider">{result.gotag_id}</div>
                <div className="text-lg font-bold text-white">{result.plate_number}</div>
                <div className="text-xs text-slate-400 font-semibold uppercase">{form.owner_name} • {form.vehicle_type}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-md mx-auto">
              <button
                onClick={() => {
                  downloadQrPng('gotag-qr-svg', `gotag-${result.gotag_id}.png`);
                  showToast('GoTag QR code downloaded!', 'success');
                }}
                className="btn-primary text-xs py-2.5"
              >
                📥 Download QR
              </button>

              <button
                onClick={() => printElement('gotag-printable-card')}
                className="btn-secondary text-xs py-2.5"
              >
                🖨️ Print Pass
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(result.gotag_id);
                  showToast('GoTag ID copied to clipboard!', 'success');
                }}
                className="btn-secondary text-xs py-2.5"
              >
                📋 Copy ID
              </button>

              <Link to="/scan" className="btn-green text-xs py-2.5 text-center">
                📷 Scan Pass
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GOTAG PASS PAGE                                                            */
/* -------------------------------------------------------------------------- */

function TagPassPage({ walletAddress, walletVehicle }: { walletAddress: string; walletVehicle: any }) {
  const [vehicle, setVehicle] = useState<any>(walletVehicle);
  const { showToast } = useToast();

  useEffect(() => {
    if (walletAddress) {
      setVehicle(walletVehicle);
    } else {
      fetch(`${API_BASE}/api/vehicles/GT-AP39-0001`)
        .then((res) => (res.ok ? res.json() : DEMO_VEHICLE))
        .then((data) => setVehicle(data))
        .catch(() => setVehicle(DEMO_VEHICLE));
    }
  }, [walletAddress, walletVehicle]);

  if (walletAddress && !vehicle) {
    return (
      <div className="max-w-xl mx-auto card p-8 text-center space-y-6 animate-fade-in border-slate-800">
        <img src="/gotag-logo.png" alt="GoTag" className="h-14 w-14 mx-auto object-contain opacity-80" />
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white">No GoTag Identity Found</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            The connected wallet <span className="font-mono text-cyan-300 font-bold">{shortAddress(walletAddress)}</span> does not have a registered GoTag pass.
          </p>
        </div>
        <Link to="/register" className="btn-primary text-xs py-3 px-6 font-bold shadow-glow inline-block">
          🆔 Register GoTag Identity &rarr;
        </Link>
      </div>
    );
  }

  if (!vehicle) return null;

  const qrPayload = JSON.stringify({ type: 'gotag', gotag_id: vehicle.gotag_id });

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <img src="/gotag-logo.png" alt="GoTag" className="h-12 w-12 mx-auto object-contain" />
        <h1 className="text-3xl font-black text-white">Digital GoTag Pass</h1>
        <p className="text-sm text-slate-400">Present this QR code to machine readers at fuel dispensers or EV stations.</p>
      </div>

      <div
        id="gotag-digital-pass"
        className="card p-8 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 border-cyan-500/40 shadow-glow text-center space-y-6"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <img src="/gotag-logo.png" alt="GoTag" className="h-10 w-10 object-contain rounded-xl border border-slate-800 bg-slate-950 p-1" />
            <div className="text-left">
              <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-400">GoTag Pass</div>
              <div className="text-lg font-bold text-white">One Pass. Every Road.</div>
            </div>
          </div>
          <span className="badge badge-active font-bold">ACTIVE</span>
        </div>

        <div className="inline-block rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
          <QRCodeSVG
            id="gotag-pass-svg"
            value={qrPayload}
            size={240}
            level="H"
            includeMargin={true}
          />
        </div>

        <div className="space-y-1">
          <div className="text-3xl font-black text-cyan-300 font-mono tracking-wider">{vehicle.gotag_id}</div>
          <div className="text-xl font-bold text-white">{vehicle.plate_number}</div>
          <div className="text-xs text-slate-400 font-semibold uppercase">{vehicle.owner_name} • {vehicle.vehicle_type || 'Vehicle'}</div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => {
            downloadQrPng('gotag-pass-svg', `gotag-pass-${vehicle.gotag_id}.png`);
            showToast('Digital GoTag pass QR downloaded!', 'success');
          }}
          className="btn-primary flex-1 text-sm"
        >
          📥 Download QR Code
        </button>
        <button
          onClick={() => printElement('gotag-digital-pass')}
          className="btn-secondary flex-1 text-sm"
        >
          🖨️ Print Digital Pass
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SCAN PAGE                                                                  */
/* -------------------------------------------------------------------------- */

function parseGoTagQr(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      if (parsed.gotag_id) return String(parsed.gotag_id).trim();
      if (parsed.id) return String(parsed.id).trim();
    }
  } catch {
    // Not JSON
  }
  if (trimmed.includes('gotag_id=')) {
    const match = trimmed.match(/gotag_id=([A-Za-z0-9-]+)/i);
    if (match && match[1]) return match[1].trim();
  }
  if (trimmed.startsWith('gotag://vehicle/')) {
    return trimmed.replace('gotag://vehicle/', '').trim();
  }
  const idMatch = trimmed.match(/GT-[A-Z0-9]+-\d+/i);
  if (idMatch) return idMatch[0].toUpperCase();
  return trimmed;
}

function ScanPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [manualGoTag, setManualGoTag] = useState('GT-AP39-0001');
  const [vehicle, setVehicle] = useState<any>(null);
  const [lookupError, setLookupError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [resolving, setResolving] = useState(false);

  async function resolveGoTag(rawInput: string) {
    setResolving(true);
    setLookupError('');
    const extractedId = parseGoTagQr(rawInput);
    if (!extractedId) {
      setVehicle(null);
      setLookupError('Invalid GoTag QR format');
      setResolving(false);
      return;
    }

    try {
      const data = await lookupVehicleByGoTag(extractedId);
      if (data.status && data.status !== 'ACTIVE') {
        setVehicle(null);
        setLookupError('GoTag vehicle is blocked');
        setResolving(false);
        return;
      }
      setVehicle(data);
      setLookupError('');
      setCameraError('');
      showToast(`Vehicle ${data.gotag_id} verified!`, 'success');
    } catch (error: any) {
      setVehicle(null);
      const msg = error.message || 'Unable to resolve GoTag.';
      if (msg === 'Vehicle not found' || msg === 'Invalid GoTag.') {
        setLookupError(`GoTag "${extractedId}" not found in system.`);
      } else {
        setLookupError(msg);
      }
    } finally {
      setResolving(false);
    }
  }

  useEffect(() => {
    if (!scanResult) return;
    resolveGoTag(scanResult).catch(() => {});
  }, [scanResult]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Try extracting from file name (e.g. gotag-GT-AP39-0001.png)
    const match = file.name.match(/GT-[A-Z0-9]+-\d+/i);
    if (match) {
      const foundId = match[0].toUpperCase();
      setScanResult(foundId);
      showToast(`Scanned from image file: ${foundId}`, 'info');
      return;
    }

    // Try reading file text
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setScanResult(text);
        showToast('Processing uploaded QR payload...', 'info');
      } else {
        showToast('Uploaded image processed. Enter GoTag ID below if not auto-detected.', 'info');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-black text-white">Scan GoTag Vehicle Pass</h1>
        <p className="text-sm text-slate-400">Scan camera QR code, upload QR image file, or enter GoTag ID to authorize services.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
              Scanner Viewport
            </h2>
            <span className="badge badge-cyan">{scanResult ? 'Detected ✓' : 'Scanning...'}</span>
          </div>

          {/* Camera Scanner Viewport */}
          <div className="relative overflow-hidden rounded-2xl border-2 border-cyan-500/40 bg-slate-950 shadow-2xl aspect-square">
            <div className="absolute inset-6 pointer-events-none z-20 border-2 border-cyan-400/60 rounded-2xl flex flex-col justify-between p-2">
              <div className="flex justify-between">
                <div className="h-6 w-6 border-t-4 border-l-4 border-cyan-400 rounded-tl-lg" />
                <div className="h-6 w-6 border-t-4 border-r-4 border-cyan-400 rounded-tr-lg" />
              </div>
              <div className="flex justify-between">
                <div className="h-6 w-6 border-b-4 border-l-4 border-cyan-400 rounded-bl-lg" />
                <div className="h-6 w-6 border-b-4 border-r-4 border-cyan-400 rounded-br-lg" />
              </div>
            </div>

            <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-glow z-10 animate-scan-line" />

            <Scanner
              onScan={(result) => {
                const value = result[0]?.rawValue || '';
                const nextValue = value.trim();
                if (nextValue) {
                  setScanResult(nextValue);
                }
              }}
              onError={(error) => {
                setCameraError('Camera access is unavailable in this environment. Use file upload or manual ID below.');
                console.warn('Camera scanner warning', error);
              }}
              formats={['qr_code']}
            />
          </div>

          {cameraError && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 font-semibold">
              ⚠️ {cameraError}
            </div>
          )}

          {/* Alternative Scan Inputs: File Upload & Manual Lookup */}
          <div className="space-y-3 pt-2">
            {/* File Upload QR Picker */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block">📁 Upload QR Code Image</label>
              <input
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.svg"
                onChange={handleFileUpload}
                className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 file:cursor-pointer"
              />
            </div>

            {/* Manual GoTag Entry & Test Buttons */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">Manual GoTag ID Lookup</label>
              <div className="flex gap-2">
                <input
                  value={manualGoTag}
                  onChange={(e) => setManualGoTag(e.target.value.toUpperCase())}
                  placeholder="GT-AP39-0001"
                  className="input-field font-mono font-bold text-cyan-300"
                />
                <button
                  onClick={() => resolveGoTag(manualGoTag)}
                  disabled={resolving}
                  className="btn-primary text-xs px-5 font-bold shrink-0"
                >
                  {resolving ? '...' : 'Resolve'}
                </button>
              </div>

              {/* Sample Test Quick Chips */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-500 font-mono">Quick Test:</span>
                <button
                  onClick={() => {
                    setManualGoTag('GT-AP39-0001');
                    resolveGoTag('GT-AP39-0001');
                  }}
                  className="text-[11px] font-mono font-bold text-cyan-400 hover:underline bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30"
                >
                  GT-AP39-0001
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* GoTag Verification & Service Selection Card */}
        <div className="card p-6 space-y-6">
          <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">GoTag Status &amp; Services</h2>

          {vehicle ? (
            <div className="space-y-6 animate-fade-in">
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3 shadow-glow-green">
                <div className="flex items-center justify-between">
                  <span className="badge badge-active font-bold">✓ GoTag Verified</span>
                  <span className="text-xs font-mono text-emerald-300 font-bold">● {vehicle.status || 'ACTIVE'}</span>
                </div>

                <div>
                  <div className="text-3xl font-black text-cyan-300 font-mono tracking-wider">{vehicle.gotag_id}</div>
                  <div className="text-base font-bold text-white mt-0.5">Plate: {vehicle.plate_number}</div>
                  <div className="text-xs text-slate-400 font-semibold mt-1">Owner: {vehicle.owner_name} • {vehicle.vehicle_type || 'Car'}</div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                  Select Mobility Service for {vehicle.gotag_id}
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  {SERVICE_CATALOG.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => navigate(`/service/${s.id}?gotag_id=${vehicle.gotag_id}`)}
                      className="card-hover p-4 text-left space-y-2 group border-slate-800 hover:border-cyan-500/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-2xl group-hover:scale-110 transition-transform">{s.icon}</span>
                        <span className="text-xs font-mono text-cyan-300 font-bold">{s.unitRate}</span>
                      </div>
                      <div>
                        <div className="font-bold text-white group-hover:text-cyan-300 transition-colors">
                          {s.desc}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{s.m2mLabel}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center space-y-4">
              {lookupError ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-center space-y-3">
                    <div className="text-3xl">🛑</div>
                    <div className="text-sm text-red-200 font-bold leading-relaxed">
                      {lookupError}
                    </div>
                    <p className="text-xs text-slate-300">
                      This vehicle identity is not currently registered in the database.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link
                      to="/register"
                      className="btn-primary text-xs py-3 px-4 font-bold flex-1 text-center shadow-glow"
                    >
                      🆔 Register GoTag Identity &rarr;
                    </Link>
                    <button
                      onClick={() => {
                        setManualGoTag('GT-AP39-0001');
                        resolveGoTag('GT-AP39-0001');
                      }}
                      className="btn-secondary text-xs py-3 px-4 flex-1 text-center font-bold"
                    >
                      🚗 Scan Demo GT-AP39-0001
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 text-sm space-y-3">
                  <div className="text-5xl animate-bounce">📷</div>
                  <div className="font-bold text-white">Awaiting GoTag QR Scan</div>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Point camera at a GoTag QR code, upload a QR image file, or click a quick test chip.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SERVICE PAGE (FUEL, EV, TOLL, PARKING + ANIMATIONS + X402)               */
/* -------------------------------------------------------------------------- */

type PaymentStep =
  | 'IDLE'
  | 'USAGE_SIMULATED'
  | 'PRICE_CALCULATED'
  | 'SERVICE_SELECTED'
  | 'PAYMENT_REQUIRED'
  | 'SESSION_CREATED'
  | 'WALLET_SIGNING'
  | 'TRANSACTION_SUBMITTED'
  | 'TRANSACTION_CONFIRMED'
  | 'PAYMENT_VERIFIED'
  | 'SETTLEMENT'
  | 'RECORD_PAYMENT'
  | 'PAID'
  | 'SERVICE_AUTHORIZED';

const PAYMENT_STEP_ORDER: PaymentStep[] = [
  'IDLE',
  'USAGE_SIMULATED',
  'PRICE_CALCULATED',
  'SERVICE_SELECTED',
  'PAYMENT_REQUIRED',
  'SESSION_CREATED',
  'WALLET_SIGNING',
  'TRANSACTION_SUBMITTED',
  'TRANSACTION_CONFIRMED',
  'PAYMENT_VERIFIED',
  'SETTLEMENT',
  'RECORD_PAYMENT',
  'PAID',
  'SERVICE_AUTHORIZED',
];

function ServicePage({
  walletAddress,
  paymentConfig,
}: {
  walletAddress: string;
  paymentConfig: {
    appId: number;
    paymentAssetId: number;
    settlementAuthority: string;
  };
}) {
  const { serviceId = 'FUEL-001' } = useParams();
  const [searchParams] = useSearchParams();
  const targetGoTagId = searchParams.get('gotag_id') || DEMO_VEHICLE.gotag_id;
  const { showToast } = useToast();

  const service = getServiceById(serviceId);

  const [machineQuantity, setMachineQuantity] = useState(service.defaultQty);
  const [dispensingAnim, setDispensingAnim] = useState(false);
  const [dispensedAmount, setDispensedAmount] = useState(0);

  const [targetVehicle, setTargetVehicle] = useState<any>(null);
  const [ownershipMismatch, setOwnershipMismatch] = useState(false);

  const [usageReceipt, setUsageReceipt] = useState<any>(null);
  const [sessionId, setSessionId] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('IDLE');
  const [walletSigned, setWalletSigned] = useState(false);
  const [algorandTxId, setAlgorandTxId] = useState('');
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [paymentSuccessful, setPaymentSuccessful] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [x402Req, setX402Req] = useState<any>(null);

  // Toll specific state
  const [tollGateMode, setTollGateMode] = useState<'ENTRY' | 'EXIT'>('ENTRY');
  const [tollActiveJourney, setTollActiveJourney] = useState<any>(null);

  // Parking specific state
  const [parkingActiveSession, setParkingActiveSession] = useState<any>(null);
  const [parkingElapsedSec, setParkingElapsedSec] = useState(0);

  const walletConnected = Boolean(walletAddress && walletAddress.trim());
  const authoritative402Amount: number = x402Req?.payment?.amount ?? x402Req?.amount ?? 0;

  useEffect(() => {
    fetch(`${API_BASE}/api/vehicles/${targetGoTagId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setTargetVehicle(data);
          if (walletAddress && data.owner_wallet.toUpperCase() !== walletAddress.toUpperCase()) {
            setOwnershipMismatch(true);
          } else {
            setOwnershipMismatch(false);
          }
        }
      })
      .catch(() => setTargetVehicle(null));
  }, [targetGoTagId, walletAddress]);

  function resetPaymentState() {
    setPaymentStep('IDLE');
    setWalletSigned(false);
    setAlgorandTxId('');
    setPaymentVerified(false);
    setPaymentSuccessful(false);
    setSessionId('');
    setError('');
    setPaymentError('');
    setResponse(null);
    setX402Req(null);
    setUsageReceipt(null);
    setTollActiveJourney(null);
    setDispensingAnim(false);
    setDispensedAmount(0);
  }

  useEffect(() => {
    setMachineQuantity(service.defaultQty);
    resetPaymentState();
  }, [serviceId]);

  useEffect(() => {
    if (service.slug === 'parking') {
      fetch(`${API_BASE}/api/services/parking/active/${targetGoTagId}`)
        .then((res) => (res.ok ? res.json() : { active: false }))
        .then((data) => {
          if (data.active) {
            setParkingActiveSession(data);
            setParkingElapsedSec(data.elapsed_seconds || 0);
          } else {
            setParkingActiveSession(null);
          }
        })
        .catch(() => setParkingActiveSession(null));
    }
  }, [serviceId, targetGoTagId]);

  useEffect(() => {
    if (service.slug === 'parking' && parkingActiveSession) {
      const timer = setInterval(() => {
        setParkingElapsedSec((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [service.slug, parkingActiveSession]);

  const isUsageService = service.slug === 'fuel' || service.slug === 'ev';
  const isTollService = service.slug === 'toll';
  const isParkingService = service.slug === 'parking';

  const steps = [
    { label: '1. Machine Event / Usage Reported', done: PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('USAGE_SIMULATED') },
    { label: '2. Backend Price Calculated', done: PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('PRICE_CALCULATED') },
    { label: '3. HTTP 402 Payment Required', done: PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('PAYMENT_REQUIRED') },
    { label: '4. GoTag Payment Agent', done: PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('SESSION_CREATED') },
    { label: '5. Wallet Authorization (Pera)', done: walletSigned && PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('WALLET_SIGNING') },
    { label: '6. Algorand TestNet Confirmed', done: Boolean(algorandTxId) && PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('TRANSACTION_CONFIRMED') },
    { label: '7. FastAPI Verification & Settlement', done: paymentVerified && PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('PAYMENT_VERIFIED') },
    { label: '8. Service Authorized & Gate Opened', done: paymentSuccessful && PAYMENT_STEP_ORDER.indexOf(paymentStep) >= PAYMENT_STEP_ORDER.indexOf('SERVICE_AUTHORIZED') },
  ];

  async function handleTollEntry() {
    if (ownershipMismatch) {
      setError(`GoTag ownership mismatch. Vehicle ${targetGoTagId} belongs to another wallet.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/services/toll/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gotag_id: targetGoTagId, toll_point_id: 'TOLL-X-ENTRY' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Toll entry failed');
      setTollActiveJourney(data);
      setTollGateMode('EXIT');
      showToast('Toll entry recorded! Journey active.', 'info');
    } catch (err: any) {
      setError(err.message || 'Toll entry failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleTollExit() {
    if (!walletConnected) {
      setPaymentError('Wallet connection required');
      setError('Connect Pera Wallet to authorize toll payment');
      return;
    }
    if (ownershipMismatch) {
      setError(`GoTag ownership mismatch. Vehicle ${targetGoTagId} belongs to another wallet.`);
      return;
    }
    setLoading(true);
    setError('');
    setPaymentError('');
    setX402Req(null);
    setPaymentStep('USAGE_SIMULATED');

    try {
      const res = await fetch(`${API_BASE}/api/services/toll/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gotag_id: targetGoTagId, toll_point_id: 'TOLL-Y-EXIT' }),
      });
      const data = await res.json();

      if (data.status === 'FREE_RETURN' || data.amount === 0) {
        setPaymentStep('SERVICE_AUTHORIZED');
        setPaymentSuccessful(true);
        setResponse({
          ...data,
          serviceName: 'Toll Gate (Vijayawada East → West)',
          isFree: true,
        });
        showToast('Returned within 30-min window — Toll Free!', 'success');
      } else if (res.status === 402 || data.payment_required) {
        setX402Req(data);
        setPaymentStep('PAYMENT_REQUIRED');
      } else if (!res.ok) {
        throw new Error(data.detail || 'Toll exit failed');
      } else {
        setResponse(data);
      }
    } catch (err: any) {
      setError(err.message || 'Toll exit failed');
      setPaymentStep('IDLE');
    } finally {
      setLoading(false);
    }
  }

  async function handleParkingEntry() {
    if (ownershipMismatch) {
      setError(`GoTag ownership mismatch. Vehicle ${targetGoTagId} belongs to another wallet.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/services/parking/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gotag_id: targetGoTagId, location_id: 'PARK-001' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Parking entry failed');
      setParkingActiveSession(data);
      setParkingElapsedSec(0);
      showToast('Parking session started! Timer running.', 'info');
    } catch (err: any) {
      setError(err.message || 'Parking entry failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleParkingExit() {
    if (!walletConnected) {
      setPaymentError('Wallet connection required');
      setError('Connect Pera Wallet to authorize parking payment');
      return;
    }
    if (ownershipMismatch) {
      setError(`GoTag ownership mismatch. Vehicle ${targetGoTagId} belongs to another wallet.`);
      return;
    }
    setLoading(true);
    setError('');
    setPaymentError('');
    setX402Req(null);
    setPaymentStep('USAGE_SIMULATED');

    try {
      const res = await fetch(`${API_BASE}/api/services/parking/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gotag_id: targetGoTagId, location_id: 'PARK-001' }),
      });
      const data = await res.json();

      if (data.status === 'PARKING_FREE' || data.amount === 0) {
        setPaymentStep('SERVICE_AUTHORIZED');
        setPaymentSuccessful(true);
        setParkingActiveSession(null);
        setResponse({
          ...data,
          serviceName: 'Central Mall Parking',
          isFree: true,
        });
        showToast('Within 15-min grace period — Parking Free!', 'success');
      } else if (res.status === 402 || data.payment_required) {
        setX402Req(data);
        setPaymentStep('PAYMENT_REQUIRED');
      } else if (!res.ok) {
        throw new Error(data.detail || 'Parking exit failed');
      } else {
        setResponse(data);
      }
    } catch (err: any) {
      setError(err.message || 'Parking exit failed');
      setPaymentStep('IDLE');
    } finally {
      setLoading(false);
    }
  }

  async function requestService() {
    if (isTollService) {
      if (tollGateMode === 'ENTRY') return handleTollEntry();
      return handleTollExit();
    }

    if (isParkingService) {
      if (!parkingActiveSession) return handleParkingEntry();
      return handleParkingExit();
    }

    if (!walletConnected) {
      setPaymentError('Wallet connection required');
      setError('Connect Pera Wallet to authorize payment');
      return;
    }

    if (ownershipMismatch) {
      setError(`GoTag ownership mismatch. Vehicle ${targetGoTagId} is registered to another wallet.`);
      return;
    }

    setLoading(true);
    setError('');
    setPaymentError('');
    setResponse(null);
    setPaymentSuccessful(false);
    setPaymentVerified(false);
    setWalletSigned(false);
    setAlgorandTxId('');
    setX402Req(null);
    setUsageReceipt(null);
    setPaymentStep('USAGE_SIMULATED');

    try {
      let amountMicros: number;
      let usagePayload: Record<string, unknown> | undefined;

      if (isUsageService) {
        const qty = parseFloat(machineQuantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error('Enter a valid machine usage quantity.');
        }

        setDispensingAnim(true);
        setDispensedAmount(0);
        for (let i = 1; i <= 5; i++) {
          await new Promise((r) => setTimeout(r, 250));
          setDispensedAmount(Number(((qty * i) / 5).toFixed(1)));
        }
        setDispensingAnim(false);

        const usageEndpoint = service.slug === 'fuel'
          ? `${API_BASE}/api/services/fuel/usage`
          : `${API_BASE}/api/services/ev/usage`;

        const usageBody = service.slug === 'fuel'
          ? { gotag_id: targetGoTagId, service_id: service.id, quantity: qty, unit: 'L' }
          : { gotag_id: targetGoTagId, service_id: service.id, energy: qty, unit: 'kWh' };

        const usageRes = await fetch(usageEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(usageBody),
        });

        if (!usageRes.ok) {
          const usageErr = await usageRes.json().catch(() => ({}));
          throw new Error(usageErr.detail || 'Machine usage calculation failed.');
        }

        const usageData = await usageRes.json();
        setUsageReceipt(usageData);
        setPaymentStep('PRICE_CALCULATED');

        amountMicros = usageData.amount_micros;
        usagePayload = service.slug === 'fuel'
          ? { quantity: qty, unit: 'L', fuel_type: 'PETROL' }
          : { energy: qty, unit: 'kWh' };
      } else {
        amountMicros = service.price;
        usagePayload = undefined;
      }

      setPaymentStep('SERVICE_SELECTED');

      const x402Body: Record<string, unknown> = {
        gotag_id: targetGoTagId,
        service_id: service.id,
        amount: amountMicros,
      };
      if (usagePayload) {
        x402Body.usage = usagePayload;
      }

      const res = await fetch(`${API_BASE}/api/x402/${service.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(x402Body),
      });

      const data = await res.json();

      if (res.status === 402 || data.payment_required) {
        setX402Req(data);
        setPaymentStep('PAYMENT_REQUIRED');
      } else if (!res.ok) {
        throw new Error(data.detail || 'Service request failed.');
      } else {
        setX402Req(null);
        setResponse(data);
      }
    } catch (err: any) {
      setError(err.message || 'Service request failed.');
      setPaymentStep('IDLE');
    } finally {
      setLoading(false);
    }
  }

  async function payWithPera() {
    if (!walletConnected) {
      setPaymentError('Wallet connection required');
      setError('Connect Pera Wallet to authorize payment');
      return;
    }

    if (ownershipMismatch) {
      setError(`GoTag ownership mismatch. Vehicle ${targetGoTagId} is registered to another wallet.`);
      return;
    }

    const amountMicros = authoritative402Amount;
    if (!amountMicros || amountMicros <= 0) {
      setError('No valid payment requirement received from backend.');
      return;
    }

    let configSettlementAuthority: string;
    try {
      configSettlementAuthority = ensureAlgorandAddress(
        x402Req?.payment?.receiver || x402Req?.to || paymentConfig.settlementAuthority,
        'Settlement authority',
      );
    } catch (err: any) {
      setError(err.message || 'Invalid settlement authority.');
      return;
    }

    const targetAssetId = Number(
      x402Req?.payment?.asset_id || x402Req?.asset_id || paymentConfig.paymentAssetId || DEFAULT_GTUSD_ASSET_ID,
    );

    setLoading(true);
    setError('');
    setPaymentError('');
    setResponse(null);
    setPaymentSuccessful(false);
    setPaymentVerified(false);
    setWalletSigned(false);
    setAlgorandTxId('');

    try {
      setPaymentStep('SESSION_CREATED');

      const sessRes = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gotag_id: targetGoTagId,
          service_id: service.id,
          amount: amountMicros,
        }),
      }).catch(() => null);

      const sessJson = sessRes?.ok ? await sessRes.json() : null;
      const activeSessionId =
        sessJson?.session_id ||
        `SESSION-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      setSessionId(activeSessionId);

      setPaymentStep('WALLET_SIGNING');

      const paymentData = await signGtusdTransfer(
        walletAddress,
        BigInt(amountMicros),
        `GoTag ${targetGoTagId}:${service.id}`,
        configSettlementAuthority,
        targetAssetId,
      );

      if (!paymentData || !paymentData.tx_id) {
        throw new Error('Payment not completed. No real Algorand transaction ID returned.');
      }

      const txId = String(paymentData.tx_id);
      setWalletSigned(true);

      setPaymentStep('TRANSACTION_SUBMITTED');
      setAlgorandTxId(txId);
      setPaymentStep('TRANSACTION_CONFIRMED');
      setPaymentStep('PAYMENT_VERIFIED');

      const retryBody: Record<string, unknown> = {
        gotag_id: targetGoTagId,
        service_id: service.id,
        amount: amountMicros,
        payment_data: {
          tx_id: txId,
          sender: walletAddress,
          receiver: configSettlementAuthority,
          asset_id: targetAssetId,
          amount: amountMicros,
        },
      };

      if (usageReceipt) {
        const usagePayload = service.slug === 'fuel'
          ? { quantity: usageReceipt.quantity, unit: 'L', fuel_type: 'PETROL' }
          : { energy: usageReceipt.energy, unit: 'kWh' };
        retryBody.usage = usagePayload;
      }

      const paymentResponse = await fetch(`${API_BASE}/api/x402/${service.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
      });

      const paymentJson = await paymentResponse.json();
      if (!paymentResponse.ok) {
        throw new Error(paymentJson.detail || 'Payment verification failed.');
      }

      if (!paymentJson.success || paymentJson.status !== 'PAID' || !paymentJson.algorand_tx_id) {
        throw new Error('Payment not completed. Backend did not confirm TestNet transaction.');
      }

      setPaymentStep('SETTLEMENT');
      setPaymentStep('RECORD_PAYMENT');
      setPaymentVerified(true);
      setPaymentStep('PAID');
      setPaymentStep('SERVICE_AUTHORIZED');
      setPaymentSuccessful(true);
      setParkingActiveSession(null);
      showToast('Payment verified & settled on Algorand TestNet!', 'success');

      setResponse({
        ...paymentJson,
        amount: amountMicros,
        serviceName: service.desc,
        sessionId: paymentJson.session_id || activeSessionId,
        algorand_tx_id: paymentJson.algorand_tx_id || txId,
        usageReceipt,
      });
    } catch (err: any) {
      console.error('PAYMENT FLOW ERROR', err);
      setPaymentError(err.message || 'Payment not completed.');
      setError(err.message || 'Payment not completed.');
      setPaymentSuccessful(false);
      setPaymentVerified(false);
      setWalletSigned(false);
      setAlgorandTxId('');
      setPaymentStep('IDLE');
    } finally {
      setLoading(false);
    }
  }

  function formatTime(totalSec: number) {
    const hrs = Math.floor(totalSec / 3600).toString().padStart(2, '0');
    const mins = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
    const secs = (totalSec % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  }

  if (response && (paymentSuccessful || response.isFree)) {
    const isFree = response.isFree || response.amount === 0;
    const explorerUrl = response.algorand_tx_id
      ? `https://testnet.explorer.perawallet.app/tx/${response.algorand_tx_id}`
      : null;

    return (
      <div className="max-w-2xl mx-auto card p-8 space-y-6 animate-fade-in">
        <div className="text-center space-y-3">
          <img src="/gotag-logo.png" alt="GoTag" className="h-16 w-16 mx-auto object-contain drop-shadow-[0_0_15px_rgba(0,208,132,0.5)]" />

          <h1 className="text-3xl font-black text-white uppercase tracking-wider">
            {isFree ? 'FREE SERVICE AUTHORIZED' : 'PAYMENT SUCCESSFUL'}
          </h1>

          <div className="text-4xl font-black text-cyan-300 font-mono">
            {isFree ? '0.00 GTUSD' : formatMicros(response.amount || 0)}
          </div>

          <div className="text-lg font-bold text-emerald-400">
            {service.desc} — Service Authorized
          </div>

          {response.reason && (
            <div className="inline-block rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 font-bold">
              ✓ {response.reason}
            </div>
          )}
        </div>

        {(isTollService || isParkingService) && (
          <BarrierGateAnimation isOpen={true} label={isFree ? '✓ FREE PASS — GATE OPENED' : '✓ PAID — GATE OPENED'} />
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-3 text-sm">
          {explorerUrl && (
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="text-slate-400">Real Algorand Transaction ID</span>
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-400 hover:underline text-xs font-bold">
                {response.algorand_tx_id.slice(0, 10)}...{response.algorand_tx_id.slice(-8)} ↗
              </a>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-400">GoTag ID</span>
            <span className="font-mono font-bold text-white">{targetGoTagId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Status</span>
            <span className="text-emerald-400 font-bold">{isFree ? 'FREE AUTHORIZATION' : 'VERIFIED & SETTLED'}</span>
          </div>
        </div>

        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full text-center text-base">
            View Real Transaction on Pera TestNet Explorer ↗
          </a>
        )}

        <div className="flex gap-4">
          <button onClick={resetPaymentState} className="btn-secondary flex-1">
            New Service
          </button>
          <Link to="/scan" className="btn-secondary flex-1 text-center">
            Scan GoTag
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400">{service.label}</span>
          <h1 className="text-3xl font-black text-white">{service.desc}</h1>
          <p className="text-xs text-slate-400">
            {isTollService
              ? 'FASTag-style automatic toll entry/exit & 30-min free return window'
              : isParkingService
              ? 'Time-based parking entry/exit with live timer & 15-min grace period'
              : 'Agent-initiated x402 payment with wallet authorization'}
          </p>
        </div>
        <span className="text-4xl">{service.icon}</span>
      </div>

      {ownershipMismatch && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-xs font-bold text-red-200">
          🛑 GoTag Ownership Mismatch: Vehicle <span className="font-mono">{targetGoTagId}</span> is registered to another wallet. You can only authorize payments for a vehicle owned by your connected wallet ({shortAddress(walletAddress)}).
        </div>
      )}

      {isTollService && (
        <div className="grid grid-cols-2 gap-3 p-1.5 bg-slate-950 rounded-2xl border border-slate-800">
          <button
            onClick={() => setTollGateMode('ENTRY')}
            className={`py-3 rounded-xl font-bold text-sm transition-all ${
              tollGateMode === 'ENTRY'
                ? 'bg-cyan-500 text-slate-950 shadow-glow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🚗 Toll Entry Gate (Vijayawada East)
          </button>
          <button
            onClick={() => setTollGateMode('EXIT')}
            className={`py-3 rounded-xl font-bold text-sm transition-all ${
              tollGateMode === 'EXIT'
                ? 'bg-cyan-500 text-slate-950 shadow-glow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🏁 Toll Exit Gate (Vijayawada West)
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6 space-y-4">
          <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3 flex items-center justify-between">
            <span>⚙️ Machine Event / Session</span>
            <span className="badge badge-cyan">Backend Pricing</span>
          </h2>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">GoTag Vehicle</span>
              <span className="font-mono font-bold text-cyan-300">{targetGoTagId}</span>
            </div>

            {dispensingAnim && (
              <div className="rounded-2xl border border-amber-500/40 bg-slate-950 p-4 text-center space-y-2 animate-pulse">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  {service.slug === 'fuel' ? '⛽ Dispensing Fuel...' : '⚡ Delivering Energy...'}
                </div>
                <div className="text-4xl font-black text-white font-mono">
                  {dispensedAmount} <span className="text-lg text-cyan-300">{service.unit}</span>
                </div>
              </div>
            )}

            {isUsageService && !dispensingAnim && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                  Simulated Machine Dispenser Reading ({service.unit})
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={machineQuantity}
                    onChange={(e) => setMachineQuantity(e.target.value)}
                    disabled={loading || paymentStep !== 'IDLE' || ownershipMismatch}
                    className="input-field font-mono font-bold text-lg text-cyan-300 w-32"
                  />
                  <span className="text-slate-300 font-bold">{service.unit}</span>
                  <span className="text-xs text-slate-500 font-mono">@ {service.unitRate}</span>
                </div>
              </div>
            )}

            {isTollService && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                {tollGateMode === 'ENTRY' ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span>Entry Gate</span><strong className="text-white">Vijayawada East (TOLL-X-ENTRY)</strong></div>
                    <div className="flex justify-between"><span>Toll Tariff</span><strong className="text-cyan-300">Car: 8 GTUSD • SUV: 15 GTUSD</strong></div>
                    <div className="flex justify-between"><span>Free Return Window</span><strong className="text-emerald-400">Within 30 Minutes (0 GTUSD)</strong></div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span>Exit Gate</span><strong className="text-white">Vijayawada West (TOLL-Y-EXIT)</strong></div>
                    <div className="flex justify-between"><span>Status</span><strong className="text-cyan-300">Checking Active Route &amp; Return Window...</strong></div>
                  </div>
                )}
                {tollActiveJourney && (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs font-mono text-emerald-300 space-y-1">
                    <div className="font-bold uppercase">✓ Toll Journey Active</div>
                    <div>Session: {tollActiveJourney.session_id}</div>
                    <div>Entry: {tollActiveJourney.entry_point}</div>
                  </div>
                )}
              </div>
            )}

            {isParkingService && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                {parkingActiveSession ? (
                  <div className="rounded-2xl border border-cyan-500/40 bg-slate-950 p-4 text-center space-y-2 shadow-glow">
                    <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">⏱️ Active Parking Timer</div>
                    <div className="text-4xl font-black text-white font-mono tracking-widest">
                      {formatTime(parkingElapsedSec)}
                    </div>
                    <div className="text-xs text-slate-400">
                      Rate: <strong className="text-cyan-300">0.50 GTUSD/hr</strong> • Grace: <strong className="text-emerald-400">15 min free</strong>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span>Parking Lot</span><strong className="text-white">Central Mall Parking Zone A</strong></div>
                    <div className="flex justify-between"><span>Hourly Tariff</span><strong className="text-cyan-300">0.50 GTUSD / hour (Ceil rounding)</strong></div>
                    <div className="flex justify-between"><span>Grace Period</span><strong className="text-emerald-400">First 15 Minutes Free</strong></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {(isTollService || isParkingService) && (
            <BarrierGateAnimation isOpen={false} label="Barrier Closed — Awaiting Scan & Authorization" />
          )}

          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">
              Payment Agent Status
            </h2>

            {authoritative402Amount > 0 && (
              <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-center space-y-1">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Required Payment (HTTP 402)</span>
                <div className="text-3xl font-black text-cyan-300 font-mono">
                  {formatMicros(authoritative402Amount)}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-semibold flex items-center justify-between transition-all ${
                    s.done
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 shadow-sm'
                      : 'border-slate-800 bg-slate-950/60 text-slate-500'
                  }`}
                >
                  <span>{s.label}</span>
                  <span>{s.done ? '✓' : '•'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {paymentStep === 'PAYMENT_REQUIRED' && x402Req ? (
        <div className="card p-6 border-amber-500/50 bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-950 space-y-4 shadow-glow-amber">
          <div className="flex items-center justify-between">
            <span className="badge border-amber-500/50 bg-amber-500/20 text-amber-300 font-bold">
              HTTP 402 Payment Required
            </span>
            <span className="badge badge-cyan font-mono">x402 Protocol</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-xs font-mono text-slate-300 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
            <div>Service: <strong className="text-white">{service.desc}</strong></div>
            <div>Amount: <strong className="text-cyan-300 text-sm">{formatMicros(authoritative402Amount)}</strong></div>
            <div>Asset: <strong className="text-slate-200">GTUSD #769016907</strong></div>
            <div>Network: <strong className="text-slate-200">Algorand TestNet</strong></div>
            <div className="sm:col-span-2 border-t border-slate-800 pt-2 break-all">
              Receiver: <strong className="text-cyan-300">{x402Req.payment?.receiver || x402Req.to}</strong>
            </div>
          </div>

          <button
            onClick={payWithPera}
            disabled={loading || !walletConnected || ownershipMismatch}
            className="btn-primary w-full text-base py-4"
          >
            {loading ? 'Processing via Pera Wallet...' : 'Authorize Agent Payment (Pera Wallet)'}
          </button>
        </div>
      ) : (paymentStep === 'IDLE' || paymentStep === 'USAGE_SIMULATED') ? (
        <button
          onClick={requestService}
          disabled={loading || ownershipMismatch}
          className="btn-green w-full text-base py-4 disabled:opacity-50"
        >
          {loading
            ? 'Processing...'
            : isTollService
            ? tollGateMode === 'ENTRY'
              ? '🚗 Scan Entry Gate (Start Toll Journey)'
              : '🏁 Scan Exit Gate & Process Toll'
            : isParkingService
            ? parkingActiveSession
              ? '⏱️ Checkout & Stop Parking Timer'
              : '🅿️ Scan Entry Gate (Start Parking Timer)'
            : walletConnected
            ? `Initiate Machine Payment (${service.label})`
            : 'Connect Wallet to Initiate'}
        </button>
      ) : null}

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 font-semibold">
          🛑 {error}
        </div>
      )}
    </div>
  );
}

function TransactionsPage({ walletAddress }: { walletAddress: string }) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    const url = walletAddress
      ? `${API_BASE}/api/transactions?wallet_address=${walletAddress}`
      : `${API_BASE}/api/transactions`;

    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTransactions(data))
      .catch(() => setTransactions([]));
  }, [walletAddress]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return transactions;
    return transactions.filter((t) => t.service_type === filter);
  }, [transactions, filter]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white">Transaction History</h1>
          <p className="text-sm text-slate-400">
            {walletAddress ? `Verifiable transactions for wallet ${shortAddress(walletAddress)}` : 'Verifiable Algorand TestNet GTUSD micro-settlements.'}
          </p>
        </div>
        <span className="badge badge-cyan font-mono self-start sm:self-auto">{filtered.length} Recorded</span>
      </div>

      <div className="flex gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        {['ALL', 'FUEL', 'EV', 'TOLL', 'PARKING', 'TOPUP'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              filter === tab
                ? 'bg-cyan-500 text-slate-950 shadow-glow'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((tx, idx) => {
          const isTopUp = tx.service_type === 'TOPUP';
          return (
            <div
              key={tx.transaction_id || idx}
              className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-700"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border text-2xl shrink-0 ${
                  isTopUp ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-cyan-500/10 border-cyan-500/30'
                }`}>
                  {isTopUp ? '💰' : tx.service_type === 'FUEL' ? '⛽' : tx.service_type === 'EV' ? '⚡' : tx.service_type === 'TOLL' ? '🚗' : '🅿️'}
                </div>
                <div className="space-y-1">
                  <div className="font-bold text-white text-base flex items-center gap-2">
                    <span>{isTopUp ? 'GTUSD TOP UP' : tx.service_type}</span>
                    <span className="text-xs font-mono text-cyan-300 font-normal">({tx.gotag_id})</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">Session: {tx.session_id}</div>
                </div>
              </div>

              <div className="sm:text-right space-y-1 border-t sm:border-0 border-slate-800 pt-3 sm:pt-0">
                <div className={`text-xl font-black font-mono ${isTopUp ? 'text-emerald-400' : 'text-cyan-300'}`}>
                  {isTopUp ? `+${(tx.amount / 1000000).toFixed(2)} GTUSD` : formatMicros(tx.amount)}
                </div>
                <div className="flex items-center sm:justify-end gap-2">
                  <span className={`badge text-[10px] py-0.5 ${isTopUp ? 'badge-active' : 'badge-cyan'}`}>{tx.status}</span>
                  {(tx.algorand_tx_id || (tx.payment_ref && tx.payment_ref.length > 10)) ? (
                    <span className="text-xs font-mono text-slate-400">
                      {(tx.algorand_tx_id || tx.payment_ref).slice(0, 8)}...
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-slate-500">{tx.payment_ref || 'FREE'}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ADMIN PAGE                                                                 */
/* -------------------------------------------------------------------------- */

function AdminPage() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  async function loadVehicles() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/vehicles`);
      if (!res.ok) throw new Error('Failed to load admin vehicle list');
      const data = await res.json();
      setVehicles(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load vehicles');
    }
  }

  useEffect(() => {
    loadVehicles();
  }, []);

  async function toggleVehicle(gotagId: string, currentStatus: string) {
    const endpoint = currentStatus === 'ACTIVE'
      ? `${API_BASE}/api/admin/vehicles/${gotagId}/block`
      : `${API_BASE}/api/admin/vehicles/${gotagId}/unblock`;

    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to update vehicle status');
      showToast(`Vehicle ${gotagId} status updated to ${currentStatus === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE'}`, 'info');
      loadVehicles();
    } catch (err: any) {
      setError(err.message || 'Action failed');
    }
  }

  const activeCount = vehicles.filter((v) => v.status === 'ACTIVE').length;
  const blockedCount = vehicles.filter((v) => v.status !== 'ACTIVE').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-white">Admin Management</h1>
        <p className="text-sm text-slate-400">Overview of registered vehicle identities, status controls, and spending limits.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5 space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Registered</span>
          <div className="text-3xl font-black text-white font-mono">{vehicles.length}</div>
        </div>
        <div className="card p-5 space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Active GoTags</span>
          <div className="text-3xl font-black text-emerald-400 font-mono">{activeCount}</div>
        </div>
        <div className="card p-5 space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-red-400">Blocked GoTags</span>
          <div className="text-3xl font-black text-red-400 font-mono">{blockedCount}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          🛑 {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4">GoTag ID</th>
                <th className="p-4">Plate</th>
                <th className="p-4">Owner</th>
                <th className="p-4">Limit / Spent</th>
                <th className="p-4">Status</th>
                <th className="p-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {vehicles.map((v) => (
                <tr key={v.gotag_id} className="hover:bg-slate-900/50 transition">
                  <td className="p-4 font-bold text-cyan-300">{v.gotag_id}</td>
                  <td className="p-4 text-white font-bold">{v.plate_number}</td>
                  <td className="p-4 text-slate-300">{v.owner_name}</td>
                  <td className="p-4 text-slate-300">
                    {formatMicros(v.spending_limit)} / {formatMicros(v.spent_amount || 0)}
                  </td>
                  <td className="p-4">
                    <span className={`badge ${v.status === 'ACTIVE' ? 'badge-active' : 'badge-blocked'}`}>
                      {v.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => toggleVehicle(v.gotag_id, v.status)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        v.status === 'ACTIVE'
                          ? 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                          : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                      }`}
                    >
                      {v.status === 'ACTIVE' ? 'Block' : 'Unblock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* APP SHELL & NAVIGATION                                                     */
/* -------------------------------------------------------------------------- */

function AppShell() {
  const location = useLocation();
  const { showToast } = useToast();
  const [walletAddress, setWalletAddress] = useState('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletVehicle, setWalletVehicle] = useState<any>(null);
  const [walletTransactions, setWalletTransactions] = useState<any[]>([]);
  const [identityRegistered, setIdentityRegistered] = useState<boolean | null>(null);

  const [walletError, setWalletError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  const [paymentConfig, setPaymentConfig] = useState({
    appId: DEFAULT_APP_ID,
    paymentAssetId: DEFAULT_GTUSD_ASSET_ID,
    settlementAuthority: DEFAULT_SETTLEMENT_AUTHORITY,
  });

  const loadWalletIdentity = (address: string) => {
    if (!address) {
      console.log('WALLET DISCONNECTED / NOT CONNECTED');
      setWalletBalance(0);
      setWalletVehicle(null);
      setWalletTransactions([]);
      setIdentityRegistered(false);
      return;
    }

    console.log('WALLET CONNECTED', { walletAddress: address });
    console.log('WALLET IDENTITY LOOKUP', { walletAddress: address });

    setWalletVehicle(null);
    setWalletTransactions([]);
    setWalletBalance(0);
    setIdentityRegistered(null);

    fetch(`${API_BASE}/api/vehicles/by-wallet/${address}`)
      .then((res) => (res.ok ? res.json() : { registered: false }))
      .then((data) => {
        console.log('WALLET IDENTITY RESULT', {
          registered: data.registered,
          gotagId: data.primary_vehicle?.gotag_id,
        });

        if (data.registered && data.primary_vehicle) {
          setWalletVehicle(data.primary_vehicle);
          setIdentityRegistered(true);
          const bal = data.primary_vehicle.available_balance ? data.primary_vehicle.available_balance / 1_000_000 : 0;
          setWalletBalance(bal);
          console.log('WALLET BALANCE LOOKUP', { walletAddress: address, assetId: 769016907, balance: bal });
        } else {
          setWalletVehicle(null);
          setIdentityRegistered(false);
          setWalletBalance(0);
          console.log('WALLET BALANCE LOOKUP', { walletAddress: address, assetId: 769016907, balance: 0 });
        }
      })
      .catch((err) => {
        console.error('Wallet identity lookup error', err);
        setWalletVehicle(null);
        setIdentityRegistered(false);
        setWalletBalance(0);
      });

    console.log('TRANSACTION LOOKUP', { walletAddress: address });
    fetch(`${API_BASE}/api/transactions?wallet_address=${address}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setWalletTransactions(data))
      .catch(() => setWalletTransactions([]));
  };

  useEffect(() => {
    async function loadPaymentConfig() {
      try {
        const response = await fetch(`${API_BASE}/api/payment-config`);
        if (!response.ok) throw new Error(`Payment config request failed: ${response.status}`);
        const data = await response.json();
        setPaymentConfig({
          appId: Number(data.app_id ?? DEFAULT_APP_ID),
          paymentAssetId: Number(data.payment_asset_id ?? DEFAULT_GTUSD_ASSET_ID),
          settlementAuthority: data.settlement_authority || DEFAULT_SETTLEMENT_AUTHORITY,
        });
      } catch (error) {
        console.warn('Payment config unavailable; using configured TestNet defaults.', error);
      }
    }
    loadPaymentConfig();
  }, []);

  useEffect(() => {
    const wc = walletConnect;
    if (!wc) return;
    async function reconnectWallet() {
      try {
        const accounts = await wc.reconnectSession();
        if (accounts && accounts.length > 0) {
          const addr = ensureAlgorandAddress(accounts[0], 'Connected wallet');
          setWalletAddress(addr);
          loadWalletIdentity(addr);
        }
      } catch {
        /* No session */
      }
    }
    reconnectWallet();
  }, []);

  async function connectWallet() {
    const wc = walletConnect;
    if (!wc) {
      setWalletError('Pera Wallet is not available in this browser.');
      return;
    }

    setConnecting(true);
    setWalletError('');

    try {
      const accounts = await wc.connect();
      if (!accounts || accounts.length === 0) {
        setWalletError('Wallet connection was cancelled.');
        return;
      }
      const address = ensureAlgorandAddress(accounts[0], 'Connected wallet');
      setWalletAddress(address);
      loadWalletIdentity(address);
      showToast('Pera Wallet connected!', 'success');
    } catch (error: any) {
      console.error('Wallet connection error', error);
      const message = error?.message || 'Wallet connection was cancelled.';
      setWalletError(
        message.toLowerCase().includes('cancel') || message.toLowerCase().includes('reject')
          ? 'Wallet connection was cancelled.'
          : message,
      );
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWallet() {
    const wc = walletConnect;
    if (!wc) return;
    try {
      await wc.disconnect();
      setWalletAddress('');
      setWalletBalance(0);
      setWalletVehicle(null);
      setWalletTransactions([]);
      setIdentityRegistered(false);
      setWalletError('');
      showToast('Wallet disconnected', 'info');
    } catch (error) {
      console.error('Wallet disconnect error', error);
    }
  }

  const walletValue = useMemo(() => shortAddress(walletAddress), [walletAddress]);

  const navLinks = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/register', label: 'Register Pass', icon: '🆔' },
    { path: '/pass', label: 'GoTag Pass', icon: '🎫' },
    { path: '/scan', label: 'Scan', icon: '📷' },
    { path: '/transactions', label: 'Transactions', icon: '📜' },
    { path: '/admin', label: 'Admin', icon: '⚡' },
  ];

  return (
    <div className="min-h-screen bg-[#050a14] text-slate-100 flex flex-col lg:flex-row pb-24 lg:pb-0">
      {/* Desktop Sticky Left Sidebar (Width 260px) */}
      <aside className="hidden lg:flex w-64 flex-col justify-between border-r border-slate-800/80 bg-[#070e1c] p-6 shrink-0 h-screen sticky top-0 z-40">
        <div className="space-y-8">
          {/* Official Logo Branding Lockup */}
          <Link to="/" className="flex items-center gap-3 group">
            <img src="/gotag-logo.png" alt="GoTag Logo" className="h-11 w-11 object-contain rounded-2xl border border-slate-800 bg-slate-950 p-1 shadow-glow group-hover:scale-105 transition-transform" />
            <div>
              <div className="text-xl font-black tracking-tight text-white flex items-center gap-1">
                GoTag <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 px-1 py-0.2 rounded-md">x402</span>
              </div>
              <div className="text-[10px] font-medium text-slate-400 tracking-wider">One Pass. Every Road.</div>
            </div>
          </Link>

          {/* Navigation Items */}
          <nav className="space-y-1.5">
            {navLinks.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-xs font-bold transition-all ${
                    active
                      ? 'bg-gradient-to-r from-cyan-500/20 to-emerald-500/10 border border-cyan-500/40 text-cyan-300 shadow-glow'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Wallet Status Chip */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Wallet Status</span>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          {walletAddress ? (
            <div className="space-y-2">
              <div className="font-mono text-xs text-emerald-300 font-bold break-all">{walletValue}</div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-400 font-mono font-bold">{walletBalance.toFixed(2)} GTUSD</span>
                <button
                  onClick={() => setShowTopUpModal(true)}
                  className="text-[10px] font-bold text-emerald-400 hover:underline bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30"
                >
                  + Top Up
                </button>
              </div>
              <button
                onClick={disconnectWallet}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={connecting}
              className="btn-primary text-xs w-full py-2.5"
            >
              {connecting ? 'Connecting...' : 'Connect Pera'}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar with Prominent + Top Up GTUSD Button */}
        <header className="sticky top-0 z-30 backdrop-blur-xl border-b border-slate-800/80 bg-[#050a14]/80 px-4 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile Brand Logo */}
            <Link to="/" className="lg:hidden flex items-center gap-2">
              <img src="/gotag-logo.png" alt="GoTag" className="h-9 w-9 object-contain rounded-xl border border-slate-800 bg-slate-950 p-1" />
            </Link>

            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 hidden sm:block">Web3 Mobility Protocol</div>
              <h2 className="text-base font-bold text-white">Algorand TestNet • GTUSD #769016907</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              ● Live Network
            </span>

            <div className="flex items-center gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 font-mono text-xs font-bold text-white hidden sm:block">
                {walletBalance.toFixed(2)} <span className="text-cyan-300">GTUSD</span>
              </div>

              <button
                onClick={() => setShowTopUpModal(true)}
                className="btn-green text-xs py-2 px-3.5 font-bold shadow-glow-green flex items-center gap-1.5"
              >
                <span>+ Top Up GTUSD</span>
              </button>
            </div>
          </div>
        </header>

        {/* Error Banner */}
        {walletError && (
          <div className="px-4 sm:px-8 mt-4">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 font-semibold flex items-center justify-between">
              <span>⚠️ {walletError}</span>
              <button onClick={() => setWalletError('')} className="text-slate-400 hover:text-white">✕</button>
            </div>
          </div>
        )}

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  walletAddress={walletAddress}
                  walletBalance={walletBalance}
                  walletVehicle={walletVehicle}
                  walletTransactions={walletTransactions}
                  identityRegistered={identityRegistered}
                  onUpdateBalance={(newBal) => setWalletBalance(newBal)}
                  onRefreshData={() => loadWalletIdentity(walletAddress)}
                />
              }
            />
            <Route path="/register" element={<RegistrationPage walletAddress={walletAddress} onRegistrationSuccess={() => loadWalletIdentity(walletAddress)} />} />
            <Route path="/pass" element={<TagPassPage walletAddress={walletAddress} walletVehicle={walletVehicle} />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/service/:serviceId" element={<ServicePage walletAddress={walletAddress} paymentConfig={paymentConfig} />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/transactions" element={<TransactionsPage walletAddress={walletAddress} />} />
          </Routes>
        </main>
      </div>

      {/* Mobile Sticky Bottom Navigation Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl border-t border-slate-800 bg-[#070e1c]/95 px-6 py-2">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <Link to="/" className="flex flex-col items-center gap-1 text-slate-400 hover:text-cyan-400 text-xs font-semibold">
            <span className="text-lg">📊</span>
            <span>Home</span>
          </Link>

          <button onClick={() => setShowTopUpModal(true)} className="flex flex-col items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs font-bold">
            <span className="text-lg">💰</span>
            <span>Top Up</span>
          </button>

          {/* Prominent Scan Button */}
          <Link to="/scan" className="flex flex-col items-center -mt-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-400 to-teal-500 p-0.5 shadow-glow-green">
              <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-950 text-2xl text-emerald-400">
                📷
              </div>
            </div>
            <span className="text-[10px] font-bold text-emerald-400 mt-1 uppercase tracking-wider">Scan</span>
          </Link>

          <Link to="/transactions" className="flex flex-col items-center gap-1 text-slate-400 hover:text-cyan-400 text-xs font-semibold">
            <span className="text-lg">📜</span>
            <span>History</span>
          </Link>

          <Link to="/pass" className="flex flex-col items-center gap-1 text-slate-400 hover:text-cyan-400 text-xs font-semibold">
            <span className="text-lg">🎫</span>
            <span>Pass</span>
          </Link>
        </div>
      </div>

      {/* Global TopUpModal */}
      <TopUpModal
        isOpen={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        gotagId={walletVehicle?.gotag_id || ''}
        currentBalance={walletBalance}
        onSuccess={(newBal) => {
          setWalletBalance(newBal);
          if (walletAddress) loadWalletIdentity(walletAddress);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
