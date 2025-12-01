"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { ethers } from "ethers";
import { useFhevm } from "fhevm-sdk";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { usePrivacyPool } from "~~/hooks/privacyPool";
import { notification } from "~~/utils/helper/notification";

// =============================================================================
// TYPES
// =============================================================================

type TabId = "deposit" | "withdraw" | "intent" | "batch";
type TokenType = "WETH" | "USDC";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const TABS: Tab[] = [
  { id: "deposit", label: "Deposit", icon: "↓" },
  { id: "withdraw", label: "Withdraw", icon: "↑" },
  { id: "intent", label: "Submit Intent", icon: "⚡" },
  { id: "batch", label: "Batch Info", icon: "📦" },
];

const INITIAL_MOCK_CHAINS = { 31337: "http://localhost:8545" };

const TOKEN_CONFIG: Record<TokenType, { decimals: number; symbol: string }> = {
  WETH: { decimals: 18, symbol: "WETH" },
  USDC: { decimals: 6, symbol: "USDC" },
};

// =============================================================================
// STYLES
// =============================================================================

const styles = {
  button: {
    base: "inline-flex items-center justify-center px-6 py-3 font-semibold transition-all duration-200 focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed border border-[#2D2D2D]",
    primary: "bg-[#FFD208] text-[#2D2D2D] hover:bg-[#A38025] cursor-pointer",
    secondary: "bg-[#2D2D2D] text-[#F4F4F4] hover:bg-[#A38025] cursor-pointer",
  },
  input: "glass-input w-full px-4 py-3 text-[#2D2D2D] placeholder:text-[#2D2D2D]/40 focus:border-[#FFD208]",
  label: "block text-sm font-semibold text-[#2D2D2D] mb-2",
  section: "glass-card-strong p-6 text-[#2D2D2D]",
  card: "glass-card p-4",
  tab: {
    base: "px-5 py-3 font-semibold transition-all duration-200 border-b-2",
    active: "border-[#FFD208] text-[#2D2D2D]",
    inactive: "border-transparent text-[#2D2D2D]/50 hover:text-[#2D2D2D]",
  },
} as const;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatBalance(balance: bigint, decimals: number): string {
  const formatted = ethers.formatUnits(balance, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function parseAmount(value: string, decimals: number): bigint {
  if (!value || isNaN(Number(value)) || Number(value) <= 0) return 0n;
  try {
    return ethers.parseUnits(value, decimals);
  } catch {
    return 0n;
  }
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// =============================================================================
// COMPONENTS
// =============================================================================

function LoadingSpinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-xs font-semibold ${
        active ? "bg-[#A38025] text-[#F4F4F4]" : "bg-[#2D2D2D]/20 text-[#2D2D2D]/60"
      }`}
    >
      {active ? "●" : "○"} {label}
    </span>
  );
}

function BalanceCard({
  symbol,
  balance,
  decimals,
}: {
  symbol: string;
  balance: bigint;
  decimals: number;
}) {
  return (
    <div className={styles.card}>
      <div className="flex justify-between items-center">
        <span className="text-sm text-[#2D2D2D]/70">{symbol}</span>
        <span className="font-mono font-semibold text-[#2D2D2D]">{formatBalance(balance, decimals)}</span>
      </div>
    </div>
  );
}

function TokenSelector({
  selected,
  onSelect,
}: {
  selected: TokenType;
  onSelect: (token: TokenType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["WETH", "USDC"] as const).map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => onSelect(token)}
          className={`${styles.button.base} ${selected === token ? styles.button.primary : styles.button.secondary}`}
        >
          {token}
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// TAB COMPONENTS
// =============================================================================

interface DepositTabProps {
  contracts: ReturnType<typeof usePrivacyPool>["contracts"];
  balances: ReturnType<typeof usePrivacyPool>["balances"];
  loading: boolean;
  onDeposit: (currency: string, amount: bigint) => Promise<any>;
}

function DepositTab({ contracts, balances, loading, onDeposit }: DepositTabProps) {
  const [selectedToken, setSelectedToken] = useState<TokenType>("WETH");
  const [amount, setAmount] = useState("");

  const tokenAddress = selectedToken === "WETH" ? contracts?.WETH : contracts?.USDC;
  const { decimals } = TOKEN_CONFIG[selectedToken];
  const balance = selectedToken === "WETH" ? balances.weth : balances.usdc;

  const handleDeposit = async () => {
    if (!tokenAddress || !amount) return;
    const parsedAmount = parseAmount(amount, decimals);
    if (parsedAmount === 0n) return;

    try {
      await onDeposit(tokenAddress, parsedAmount);
      notification.success("Deposit successful!");
      setAmount("");
    } catch (error: any) {
      notification.error(error.message || "Deposit failed");
    }
  };

  const setMaxAmount = () => {
    setAmount(ethers.formatUnits(balance, decimals));
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <BalanceCard symbol="WETH Balance" balance={balances.weth} decimals={18} />
        <BalanceCard symbol="USDC Balance" balance={balances.usdc} decimals={6} />
      </div>

      <div>
        <label className={styles.label}>Token</label>
        <TokenSelector selected={selectedToken} onSelect={setSelectedToken} />
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className={styles.label + " mb-0"}>Amount</label>
          <button type="button" onClick={setMaxAmount} className="text-xs text-[#A38025] hover:underline">
            MAX
          </button>
        </div>
        <input
          type="number"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={styles.input}
          min="0"
          step="any"
        />
      </div>

      <button
        type="button"
        onClick={handleDeposit}
        disabled={!amount || parseAmount(amount, decimals) === 0n || loading}
        className={`${styles.button.base} ${styles.button.primary} w-full`}
      >
        {loading ? <LoadingSpinner /> : "Deposit"}
      </button>
    </div>
  );
}

interface WithdrawTabProps {
  contracts: ReturnType<typeof usePrivacyPool>["contracts"];
  balances: ReturnType<typeof usePrivacyPool>["balances"];
  loading: boolean;
  address: string | undefined;
  onWithdraw: (currency: string, amount: bigint, recipient?: string) => Promise<any>;
}

function WithdrawTab({ contracts, balances, loading, address, onWithdraw }: WithdrawTabProps) {
  const [selectedToken, setSelectedToken] = useState<TokenType>("WETH");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");

  const tokenAddress = selectedToken === "WETH" ? contracts?.WETH : contracts?.USDC;
  const { decimals } = TOKEN_CONFIG[selectedToken];

  const handleWithdraw = async () => {
    if (!tokenAddress || !amount) return;
    const parsedAmount = parseAmount(amount, decimals);
    if (parsedAmount === 0n) return;

    try {
      await onWithdraw(tokenAddress, parsedAmount, recipient || undefined);
      notification.success("Withdrawal successful!");
      setAmount("");
    } catch (error: any) {
      notification.error(error.message || "Withdrawal failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <BalanceCard symbol="WETH Balance" balance={balances.weth} decimals={18} />
        <BalanceCard symbol="USDC Balance" balance={balances.usdc} decimals={6} />
      </div>

      <div>
        <label className={styles.label}>Token</label>
        <TokenSelector selected={selectedToken} onSelect={setSelectedToken} />
      </div>

      <div>
        <label className={styles.label}>Amount</label>
        <input
          type="number"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={styles.input}
          min="0"
          step="any"
        />
      </div>

      <div>
        <label className={styles.label}>Recipient (optional)</label>
        <input
          type="text"
          placeholder={address || "0x..."}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          className={styles.input}
        />
        <p className="text-xs text-[#2D2D2D]/50 mt-1">Leave empty to withdraw to your address</p>
      </div>

      <button
        type="button"
        onClick={handleWithdraw}
        disabled={!amount || parseAmount(amount, decimals) === 0n || loading}
        className={`${styles.button.base} ${styles.button.primary} w-full`}
      >
        {loading ? <LoadingSpinner /> : "Withdraw"}
      </button>
    </div>
  );
}

interface IntentTabProps {
  contracts: ReturnType<typeof usePrivacyPool>["contracts"];
  balances: ReturnType<typeof usePrivacyPool>["balances"];
  loading: boolean;
  onSubmitIntent: (currency: string, amount: bigint, action: number, deadline?: bigint) => Promise<any>;
  onSetOperator: (tokenAddress: string, operatorAddress: string) => Promise<any>;
}

function IntentTab({ contracts, balances, loading, onSubmitIntent, onSetOperator }: IntentTabProps) {
  const [selectedToken, setSelectedToken] = useState<TokenType>("WETH");
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<0 | 1>(0);
  const [isSettingOperator, setIsSettingOperator] = useState(false);

  const tokenAddress = selectedToken === "WETH" ? contracts?.WETH : contracts?.USDC;
  const { decimals } = TOKEN_CONFIG[selectedToken];

  const handleSetOperator = async () => {
    if (!tokenAddress || !contracts?.PrivacyPoolHook) return;
    setIsSettingOperator(true);
    try {
      await onSetOperator(tokenAddress, contracts.PrivacyPoolHook);
      notification.success("Operator set!");
    } catch (error: any) {
      notification.error(error.message || "Failed to set operator");
    } finally {
      setIsSettingOperator(false);
    }
  };

  const handleSubmit = async () => {
    if (!tokenAddress || !amount) return;
    const parsedAmount = parseAmount(amount, decimals);
    if (parsedAmount === 0n) return;

    try {
      await onSubmitIntent(tokenAddress, parsedAmount, action);
      notification.success("Intent submitted!");
      setAmount("");
    } catch (error: any) {
      notification.error(error.message || "Failed to submit intent");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <BalanceCard symbol="WETH Balance" balance={balances.weth} decimals={18} />
        <BalanceCard symbol="USDC Balance" balance={balances.usdc} decimals={6} />
      </div>

      <div>
        <label className={styles.label}>Input Token</label>
        <TokenSelector selected={selectedToken} onSelect={setSelectedToken} />
      </div>

      <div>
        <label className={styles.label}>Amount (encrypted)</label>
        <input
          type="number"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={styles.input}
          min="0"
          step="any"
        />
      </div>

      <div>
        <label className={styles.label}>Direction (encrypted)</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAction(0)}
            className={`${styles.button.base} ${action === 0 ? styles.button.primary : styles.button.secondary}`}
          >
            Swap →
          </button>
          <button
            type="button"
            onClick={() => setAction(1)}
            className={`${styles.button.base} ${action === 1 ? styles.button.primary : styles.button.secondary}`}
          >
            ← Reverse
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleSetOperator}
          disabled={isSettingOperator}
          className={`${styles.button.base} ${styles.button.secondary}`}
        >
          {isSettingOperator ? <LoadingSpinner /> : "Set Operator"}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!amount || parseAmount(amount, decimals) === 0n || loading}
          className={`${styles.button.base} ${styles.button.primary}`}
        >
          {loading ? <LoadingSpinner /> : "Submit Intent"}
        </button>
      </div>

      <p className="text-xs text-[#2D2D2D]/50">
        Set operator before first intent submission. Both amount and direction are encrypted.
      </p>
    </div>
  );
}

interface BatchTabProps {
  contracts: ReturnType<typeof usePrivacyPool>["contracts"];
  poolKey: ReturnType<typeof usePrivacyPool>["poolKey"];
  loading: boolean;
  onFinalizeBatch: (poolId: string) => Promise<any>;
  getBatchInfo: (batchId: string) => Promise<any>;
  getRelayer: () => Promise<string | null>;
  getPoolReserves: (poolId: string) => Promise<any>;
}

function BatchTab({
  contracts,
  poolKey,
  loading,
  onFinalizeBatch,
  getBatchInfo,
  getRelayer,
  getPoolReserves,
}: BatchTabProps) {
  const [batchId, setBatchId] = useState("");
  const [batchInfo, setBatchInfo] = useState<any>(null);
  const [relayer, setRelayer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    getRelayer().then(setRelayer);
  }, [getRelayer]);

  const handleLookup = async () => {
    if (!batchId) return;
    setIsLoading(true);
    try {
      const info = await getBatchInfo(batchId);
      setBatchInfo(info);
    } catch {
      notification.error("Failed to fetch batch info");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!batchId) return;
    try {
      await onFinalizeBatch(batchId);
      notification.success("Batch finalized!");
      handleLookup();
    } catch (error: any) {
      notification.error(error.message || "Failed to finalize");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={styles.card}>
          <h4 className="font-semibold text-sm mb-3">Contracts</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#2D2D2D]/60">Hook</span>
              <span className="font-mono">{truncateAddress(contracts?.PrivacyPoolHook || "")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#2D2D2D]/60">Relayer</span>
              <span className="font-mono">{relayer ? truncateAddress(relayer) : "..."}</span>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h4 className="font-semibold text-sm mb-3">Pool Config</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#2D2D2D]/60">Fee</span>
              <span>{poolKey?.fee ? `${poolKey.fee / 10000}%` : "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#2D2D2D]/60">Tick Spacing</span>
              <span>{poolKey?.tickSpacing || "-"}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className={styles.label}>Batch / Pool ID</label>
        <input
          type="text"
          placeholder="0x..."
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
          className={styles.input}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleLookup}
          disabled={!batchId || isLoading}
          className={`${styles.button.base} ${styles.button.secondary}`}
        >
          {isLoading ? <LoadingSpinner /> : "Lookup"}
        </button>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={!batchId || loading}
          className={`${styles.button.base} ${styles.button.primary}`}
        >
          {loading ? <LoadingSpinner /> : "Finalize"}
        </button>
      </div>

      {batchInfo && (
        <div className={styles.card}>
          <h4 className="font-semibold text-sm mb-3">Batch Info</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#2D2D2D]/60">Total Intents</span>
              <span>{batchInfo.totalIntents?.toString() || "0"}</span>
            </div>
            <div className="flex gap-2 mt-2">
              <StatusBadge active={batchInfo.finalized} label="Finalized" />
              <StatusBadge active={batchInfo.settled} label="Settled" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PrivacyPoolDemo() {
  const { isConnected, chain, address } = useAccount();
  const chainId = chain?.id;

  // FHEVM Setup
  const provider = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return (window as any).ethereum;
  }, []);

  const [isMounted, setIsMounted] = useState(false);
  const [fhevmEnabled, setFhevmEnabled] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    const shouldEnable = Boolean(provider && chainId);
    if (shouldEnable && !fhevmEnabled) {
      const timeout = setTimeout(() => setFhevmEnabled(true), 500);
      return () => clearTimeout(timeout);
    } else if (!shouldEnable && fhevmEnabled) {
      setFhevmEnabled(false);
    }
  }, [isMounted, provider, chainId, fhevmEnabled]);

  const { instance: fhevmInstance, status: fhevmStatus } = useFhevm({
    provider,
    chainId,
    initialMockChains: INITIAL_MOCK_CHAINS,
    enabled: fhevmEnabled,
  });

  // Privacy Pool Hook
  const privacyPool = usePrivacyPool({
    instance: fhevmInstance,
    initialMockChains: INITIAL_MOCK_CHAINS,
  });

  // Tab State
  const [activeTab, setActiveTab] = useState<TabId>("deposit");

  // Not Connected
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto p-6 min-h-[50vh] flex items-center justify-center">
        <div className="glass-card-strong p-10 text-center">
          <div className="mb-5">
            <span className="inline-flex items-center justify-center w-16 h-16 bg-[#FFD208] text-4xl border border-[#2D2D2D]">
              🔐
            </span>
          </div>
          <h2 className="text-2xl font-bold text-[#2D2D2D] mb-2">Privacy Pool</h2>
          <p className="text-[#2D2D2D]/60 mb-6 text-sm">Connect wallet for private swaps</p>
          <RainbowKitCustomConnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-[#2D2D2D]">Privacy Pool</h1>
        <p className="text-sm text-[#2D2D2D]/60">Encrypted swaps on Uniswap V4</p>
      </div>

      {/* Status */}
      <div className={styles.section}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <StatusBadge active={isConnected} label="Connected" />
            <StatusBadge active={fhevmStatus === "ready"} label="FHE" />
          </div>
          <span className="font-mono text-xs text-[#2D2D2D]/60">
            {address ? truncateAddress(address) : ""}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#2D2D2D]/10">
        <nav className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`${styles.tab.base} ${activeTab === tab.id ? styles.tab.active : styles.tab.inactive}`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className={styles.section}>
        {activeTab === "deposit" && (
          <DepositTab
            contracts={privacyPool.contracts}
            balances={privacyPool.balances}
            loading={privacyPool.loading}
            onDeposit={privacyPool.deposit}
          />
        )}
        {activeTab === "withdraw" && (
          <WithdrawTab
            contracts={privacyPool.contracts}
            balances={privacyPool.balances}
            loading={privacyPool.loading}
            address={address}
            onWithdraw={privacyPool.withdraw}
          />
        )}
        {activeTab === "intent" && (
          <IntentTab
            contracts={privacyPool.contracts}
            balances={privacyPool.balances}
            loading={privacyPool.loading}
            onSubmitIntent={privacyPool.submitIntent}
            onSetOperator={privacyPool.setOperatorForToken}
          />
        )}
        {activeTab === "batch" && (
          <BatchTab
            contracts={privacyPool.contracts}
            poolKey={privacyPool.poolKey}
            loading={privacyPool.loading}
            onFinalizeBatch={privacyPool.finalizeBatch}
            getBatchInfo={privacyPool.getBatchInfo}
            getRelayer={privacyPool.getRelayer}
            getPoolReserves={privacyPool.getPoolReserves}
          />
        )}
      </div>

      {/* Message */}
      {privacyPool.message && (
        <div className={`${styles.section} text-sm`}>
          <span className="mr-2">💬</span>
          {privacyPool.message}
        </div>
      )}

      {/* Error */}
      {privacyPool.error && (
        <div className="glass-card-strong p-4 border-l-4 border-red-500 text-sm">
          <span className="mr-2">⚠️</span>
          {privacyPool.error}
        </div>
      )}
    </div>
  );
}
