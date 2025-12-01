// Contract addresses for Privacy Pool Hook deployment

export const DEFAULT_CHAIN_ID = 11155111; // Sepolia

// Privacy Pool Contract Addresses
export const PRIVACY_POOL_CONTRACTS = {
  // Sepolia Testnet
  11155111: {
    // Core Privacy Pool Hook
    PrivacyPoolHook: "0x80B884a77Cb6167B884d3419019Df790E65440C0",

    // Pool Manager (Uniswap V4)
    PoolManager: "0x8aD72E658564CB5DafFa0EA2608BDF51f1Fa5a4c",

    // Test Tokens
    USDC: "0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0",
    WETH: "0x0003897f666B36bf31Aa48BEEA2A57B16e60448b",

    // Supporting Contracts
    SimpleLending: "0x3b64D86362ec9a8Cae77C661ffc95F0bbd440aa2",
    SettlementLib: "0x75E19a6273beA6888c85B2BF43D57Ab89E7FCb6E",
    DeltaZeroStrategy: "0x0000000000000000000000000000000000000000", // TODO: Deploy if needed

    // Pool Key Configuration (update after PrivacyPoolHook deployment)
    poolKey: {
      currency0: "0x0003897f666B36bf31Aa48BEEA2A57B16e60448b", // WETH (lower address)
      currency1: "0xC9D872b821A6552a37F6944F66Fc3E3BA55916F0", // USDC (higher address)
      fee: 3000, // 0.3%
      tickSpacing: 60,
      hooks: "0x80B884a77Cb6167B884d3419019Df790E65440C0", // PrivacyPoolHook
    },
  },
} as const;

// Relayer address for batch settlement
export const RELAYER_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: "0x0000000000000000000000000000000000000000" as `0x${string}`, // TODO: Update with actual relayer
};

export type PrivacyPoolContractKeys = keyof (typeof PRIVACY_POOL_CONTRACTS)[11155111];

export function getPrivacyPoolContracts(chainId: number = DEFAULT_CHAIN_ID) {
  return PRIVACY_POOL_CONTRACTS[chainId as keyof typeof PRIVACY_POOL_CONTRACTS];
}

export function getRelayerAddress(chainId: number | undefined): `0x${string}` | undefined {
  if (!chainId) return undefined;
  return RELAYER_ADDRESSES[chainId] ?? undefined;
}

// Pool configuration helper
export function getPoolKey(chainId: number = DEFAULT_CHAIN_ID) {
  const contracts = getPrivacyPoolContracts(chainId);
  if (!contracts) return undefined;
  return contracts.poolKey;
}
