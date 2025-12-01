"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { ethers } from "ethers";
import { useAccount } from "wagmi";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import { useFHEEncryption, useInMemoryStorage } from "fhevm-sdk";
import type { FhevmInstance } from "fhevm-sdk";
import { getPrivacyPoolContracts, getPoolKey } from "@/config/contracts";
import PrivacyPoolHookABI from "@/abis/PrivacyPoolHook.json";
import PoolEncryptedTokenABI from "@/abis/PoolEncryptedToken.json";
import MockERC20ABI from "@/abis/MockERC20.json";

// =============================================================================
// TYPES
// =============================================================================

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface BatchInfo {
  poolId: string;
  finalized: boolean;
  settled: boolean;
  counter: bigint;
  totalIntents: bigint;
  finalizedTimestamp: bigint;
}

export interface IntentInfo {
  encryptedAmount: string;
  encryptedAction: string;
  owner: string;
  deadline: bigint;
  processed: boolean;
  batchId: string;
  submitTimestamp: bigint;
}

export interface TokenBalances {
  weth: bigint;
  usdc: bigint;
}

export interface TokenAllowances {
  weth: bigint;
  usdc: bigint;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const UINT64_MAX = (1n << 64n) - 1n;
const OPERATOR_VALIDITY_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_UINT256 = ethers.MaxUint256;

// =============================================================================
// HOOK
// =============================================================================

export function usePrivacyPool(parameters: {
  instance: FhevmInstance | undefined;
  initialMockChains?: Readonly<Record<number, string>>;
}) {
  const { instance, initialMockChains } = parameters;
  const { address } = useAccount();
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  const { chainId, isConnected, ethersReadonlyProvider, ethersSigner } =
    useWagmiEthers(initialMockChains);

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [balances, setBalances] = useState<TokenBalances>({ weth: 0n, usdc: 0n });
  const [allowances, setAllowances] = useState<TokenAllowances>({ weth: 0n, usdc: 0n });
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Contracts config
  const contracts = useMemo(() => getPrivacyPoolContracts(chainId), [chainId]);
  const poolKey = useMemo(() => getPoolKey(chainId), [chainId]);

  // =============================================================================
  // CONTRACT INSTANCES
  // =============================================================================

  const getPrivacyPoolHook = useCallback(() => {
    if (!ethersSigner || !contracts) return null;
    return new ethers.Contract(contracts.PrivacyPoolHook, PrivacyPoolHookABI, ethersSigner);
  }, [ethersSigner, contracts]);

  const getReadOnlyPrivacyPoolHook = useCallback(() => {
    if (!ethersReadonlyProvider || !contracts) return null;
    return new ethers.Contract(contracts.PrivacyPoolHook, PrivacyPoolHookABI, ethersReadonlyProvider);
  }, [ethersReadonlyProvider, contracts]);

  const getEncryptedToken = useCallback(
    (tokenAddress: string) => {
      if (!ethersSigner) return null;
      return new ethers.Contract(tokenAddress, PoolEncryptedTokenABI, ethersSigner);
    },
    [ethersSigner]
  );

  const getReadOnlyToken = useCallback(
    (tokenAddress: string) => {
      if (!ethersReadonlyProvider) return null;
      return new ethers.Contract(tokenAddress, MockERC20ABI, ethersReadonlyProvider);
    },
    [ethersReadonlyProvider]
  );

  const getMockToken = useCallback(
    (tokenAddress: string) => {
      if (!ethersSigner) return null;
      return new ethers.Contract(tokenAddress, MockERC20ABI, ethersSigner);
    },
    [ethersSigner]
  );

  // Encryption helper
  const { encryptWith } = useFHEEncryption({
    instance,
    ethersSigner: ethersSigner as any,
    contractAddress: contracts?.PrivacyPoolHook,
  });

  // =============================================================================
  // BALANCE & ALLOWANCE FETCHING
  // =============================================================================

  const refreshBalances = useCallback(async () => {
    if (!address || !contracts || !ethersReadonlyProvider) return;

    try {
      const wethToken = getReadOnlyToken(contracts.WETH);
      const usdcToken = getReadOnlyToken(contracts.USDC);

      if (!wethToken || !usdcToken) return;

      const [wethBalance, usdcBalance, wethAllowance, usdcAllowance] = await Promise.all([
        wethToken.balanceOf(address),
        usdcToken.balanceOf(address),
        wethToken.allowance(address, contracts.PrivacyPoolHook),
        usdcToken.allowance(address, contracts.PrivacyPoolHook),
      ]);

      setBalances({ weth: wethBalance, usdc: usdcBalance });
      setAllowances({ weth: wethAllowance, usdc: usdcAllowance });
    } catch (err) {
      console.error("Failed to fetch balances:", err);
    }
  }, [address, contracts, ethersReadonlyProvider, getReadOnlyToken]);

  // Auto-refresh balances
  useEffect(() => {
    refreshBalances();
  }, [refreshBalances, refreshTrigger]);

  // Trigger refresh
  const triggerRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  // =============================================================================
  // HELPER: CHECK & APPROVE IF NEEDED
  // =============================================================================

  const ensureAllowance = useCallback(
    async (tokenAddress: string, amount: bigint): Promise<void> => {
      if (!address || !contracts) throw new Error("Not connected");

      const token = getMockToken(tokenAddress);
      if (!token) throw new Error("Token not found");

      const currentAllowance = await token.allowance(address, contracts.PrivacyPoolHook);

      if (currentAllowance < amount) {
        setMessage("Approving tokens...");
        const tx = await token.approve(contracts.PrivacyPoolHook, MAX_UINT256);
        await tx.wait();
        setMessage("Tokens approved");
      }
    },
    [address, contracts, getMockToken]
  );

  // =============================================================================
  // CORE FUNCTIONS
  // =============================================================================

  /**
   * Deposit tokens (auto-approves if needed)
   */
  const deposit = useCallback(
    async (currency: string, amount: bigint) => {
      if (!address || !ethersSigner || !contracts || !poolKey) {
        throw new Error("Wallet not connected or contracts not loaded");
      }
      if (amount <= 0n) {
        throw new Error("Amount must be greater than zero");
      }

      setLoading(true);
      setError(null);

      try {
        // Step 1: Ensure allowance
        await ensureAllowance(currency, amount);

        // Step 2: Deposit
        setMessage("Depositing tokens...");
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        const key = {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        };

        const tx = await hook.deposit(key, currency, amount);
        await tx.wait();

        setMessage("Deposit successful!");
        triggerRefresh();
        return tx;
      } catch (err: any) {
        const errorMsg = err.message || "Failed to deposit";
        setError(errorMsg);
        setMessage("");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, poolKey, getPrivacyPoolHook, ensureAllowance, triggerRefresh]
  );

  /**
   * Withdraw encrypted tokens back to ERC20
   */
  const withdraw = useCallback(
    async (currency: string, amount: bigint, recipient?: string) => {
      if (!address || !ethersSigner || !contracts || !poolKey) {
        throw new Error("Wallet not connected");
      }
      if (amount <= 0n) {
        throw new Error("Amount must be greater than zero");
      }

      setLoading(true);
      setError(null);
      setMessage("Withdrawing tokens...");

      try {
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        const key = {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        };

        const tx = await hook.withdraw(key, currency, amount, recipient || address);
        await tx.wait();

        setMessage("Withdrawal successful!");
        triggerRefresh();
        return tx;
      } catch (err: any) {
        const errorMsg = err.message || "Failed to withdraw";
        setError(errorMsg);
        setMessage("");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, poolKey, getPrivacyPoolHook, triggerRefresh]
  );

  /**
   * Submit an encrypted swap intent
   */
  const submitIntent = useCallback(
    async (inputCurrency: string, amount: bigint, action: number, deadline: bigint = 0n) => {
      if (!address || !ethersSigner || !contracts || !poolKey || !instance) {
        throw new Error("Wallet not connected or FHE not initialized");
      }
      if (amount <= 0n || amount > UINT64_MAX) {
        throw new Error("Invalid amount");
      }

      setLoading(true);
      setError(null);
      setMessage("Encrypting intent...");

      try {
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        // Encrypt amount (euint64)
        const amountInput = instance.createEncryptedInput(contracts.PrivacyPoolHook, address);
        amountInput.add64(amount);
        const encryptedAmountData = await amountInput.encrypt();

        // Encrypt action (euint8)
        const actionInput = instance.createEncryptedInput(contracts.PrivacyPoolHook, address);
        actionInput.add8(action);
        const encryptedActionData = await actionInput.encrypt();

        // Get handles and proofs
        const amountHandle = ethers.hexlify(encryptedAmountData.handles?.[0] as Uint8Array);
        const amountProof = ethers.hexlify(encryptedAmountData.inputProof ?? ("0x" as `0x${string}`));
        const actionHandle = ethers.hexlify(encryptedActionData.handles?.[0] as Uint8Array);
        const actionProof = ethers.hexlify(encryptedActionData.inputProof ?? ("0x" as `0x${string}`));

        const key = {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        };

        setMessage("Submitting intent...");
        const tx = await hook.submitIntent(
          key,
          inputCurrency,
          amountHandle,
          amountProof,
          actionHandle,
          actionProof,
          deadline
        );
        const receipt = await tx.wait();

        setMessage("Intent submitted!");
        triggerRefresh();
        return { tx, receipt };
      } catch (err: any) {
        const errorMsg = err.message || "Failed to submit intent";
        setError(errorMsg);
        setMessage("");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, poolKey, instance, getPrivacyPoolHook, triggerRefresh]
  );

  // =============================================================================
  // BATCH MANAGEMENT
  // =============================================================================

  const finalizeBatch = useCallback(
    async (poolId: string) => {
      if (!address || !ethersSigner || !contracts) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);
      setMessage("Finalizing batch...");

      try {
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        const tx = await hook.finalizeBatch(poolId);
        await tx.wait();

        setMessage("Batch finalized!");
        return tx;
      } catch (err: any) {
        const errorMsg = err.message || "Failed to finalize batch";
        setError(errorMsg);
        setMessage("");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, getPrivacyPoolHook]
  );

  const settleBatch = useCallback(
    async (
      batchId: string,
      internalTransfers: Array<{ from: string; to: string; encryptedToken: string; encryptedAmount: string }>,
      netAmountIn: bigint,
      tokenIn: string,
      tokenOut: string,
      outputToken: string,
      userShares: Array<{ user: string; shareNumerator: bigint }>,
      pythPriceUpdate: string = "0x"
    ) => {
      if (!address || !ethersSigner || !contracts) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);
      setMessage("Settling batch...");

      try {
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        const tx = await hook.settleBatch(
          batchId,
          internalTransfers,
          netAmountIn,
          tokenIn,
          tokenOut,
          outputToken,
          userShares,
          pythPriceUpdate
        );
        await tx.wait();

        setMessage("Batch settled!");
        triggerRefresh();
        return tx;
      } catch (err: any) {
        const errorMsg = err.message || "Failed to settle batch";
        setError(errorMsg);
        setMessage("");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, getPrivacyPoolHook, triggerRefresh]
  );

  // =============================================================================
  // ADMIN FUNCTIONS
  // =============================================================================

  const updateRelayer = useCallback(
    async (newRelayer: string) => {
      if (!address || !ethersSigner || !contracts) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);

      try {
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        const tx = await hook.updateRelayer(newRelayer);
        await tx.wait();

        setMessage("Relayer updated!");
        return tx;
      } catch (err: any) {
        setError(err.message || "Failed to update relayer");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, getPrivacyPoolHook]
  );

  const setSimpleLending = useCallback(
    async (lendingAddress: string) => {
      if (!address || !ethersSigner || !contracts) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);

      try {
        const hook = getPrivacyPoolHook();
        if (!hook) throw new Error("PrivacyPoolHook contract not initialized");

        const tx = await hook.setSimpleLending(lendingAddress);
        await tx.wait();

        setMessage("SimpleLending set!");
        return tx;
      } catch (err: any) {
        setError(err.message || "Failed to set SimpleLending");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, contracts, getPrivacyPoolHook]
  );

  const setOperatorForToken = useCallback(
    async (encryptedTokenAddress: string, operatorAddress: string) => {
      if (!address || !ethersSigner) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);

      try {
        const token = getEncryptedToken(encryptedTokenAddress);
        if (!token) throw new Error("Token contract not initialized");

        const isAlreadyOperator = await token.isOperator(address, operatorAddress);
        if (isAlreadyOperator) {
          setMessage("Operator already set");
          return;
        }

        const expiry = Math.floor(Date.now() / 1000) + OPERATOR_VALIDITY_SECONDS;
        const tx = await token.setOperator(operatorAddress, expiry);
        await tx.wait();

        setMessage("Operator set!");
        return tx;
      } catch (err: any) {
        setError(err.message || "Failed to set operator");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, ethersSigner, getEncryptedToken]
  );

  // =============================================================================
  // READ FUNCTIONS
  // =============================================================================

  const getBatchInfo = useCallback(
    async (batchId: string): Promise<BatchInfo | null> => {
      const hook = getReadOnlyPrivacyPoolHook();
      if (!hook) return null;

      try {
        const batch = await hook.batches(batchId);
        return {
          poolId: batch.poolId,
          finalized: batch.finalized,
          settled: batch.settled,
          counter: batch.counter,
          totalIntents: batch.totalIntents,
          finalizedTimestamp: batch.finalizedTimestamp,
        };
      } catch {
        return null;
      }
    },
    [getReadOnlyPrivacyPoolHook]
  );

  const getCurrentBatchId = useCallback(
    async (poolId: string): Promise<string | null> => {
      const hook = getReadOnlyPrivacyPoolHook();
      if (!hook) return null;

      try {
        return await hook.currentBatchId(poolId);
      } catch {
        return null;
      }
    },
    [getReadOnlyPrivacyPoolHook]
  );

  const getIntentInfo = useCallback(
    async (intentId: string): Promise<IntentInfo | null> => {
      const hook = getReadOnlyPrivacyPoolHook();
      if (!hook) return null;

      try {
        const intent = await hook.intents(intentId);
        return {
          encryptedAmount: intent.encryptedAmount,
          encryptedAction: intent.encryptedAction,
          owner: intent.owner,
          deadline: intent.deadline,
          processed: intent.processed,
          batchId: intent.batchId,
          submitTimestamp: intent.submitTimestamp,
        };
      } catch {
        return null;
      }
    },
    [getReadOnlyPrivacyPoolHook]
  );

  const getRelayer = useCallback(async (): Promise<string | null> => {
    const hook = getReadOnlyPrivacyPoolHook();
    if (!hook) return null;

    try {
      return await hook.relayer();
    } catch {
      return null;
    }
  }, [getReadOnlyPrivacyPoolHook]);

  const getPoolEncryptedToken = useCallback(
    async (poolId: string, currency: string): Promise<string | null> => {
      const hook = getReadOnlyPrivacyPoolHook();
      if (!hook) return null;

      try {
        return await hook.poolEncryptedTokens(poolId, currency);
      } catch {
        return null;
      }
    },
    [getReadOnlyPrivacyPoolHook]
  );

  const getPoolReserves = useCallback(
    async (poolId: string) => {
      const hook = getReadOnlyPrivacyPoolHook();
      if (!hook) return null;

      try {
        const reserves = await hook.poolReserves(poolId);
        return {
          currency0Reserve: reserves.currency0Reserve,
          currency1Reserve: reserves.currency1Reserve,
          totalDeposits: reserves.totalDeposits,
          totalWithdrawals: reserves.totalWithdrawals,
        };
      } catch {
        return null;
      }
    },
    [getReadOnlyPrivacyPoolHook]
  );

  // =============================================================================
  // RETURN
  // =============================================================================

  return {
    // State
    loading,
    error,
    message,
    contracts,
    poolKey,
    chainId,
    isConnected,
    address,

    // Balances
    balances,
    allowances,
    refreshBalances,

    // Core functions
    deposit,
    withdraw,
    submitIntent,

    // Batch management
    finalizeBatch,
    settleBatch,

    // Admin functions
    updateRelayer,
    setSimpleLending,
    setOperatorForToken,

    // Read functions
    getBatchInfo,
    getCurrentBatchId,
    getIntentInfo,
    getRelayer,
    getPoolEncryptedToken,
    getPoolReserves,

    // Contract getters
    getPrivacyPoolHook,
    getEncryptedToken,
    getMockToken,
  };
}
