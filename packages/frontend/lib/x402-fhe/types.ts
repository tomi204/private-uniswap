/**
 * x402-FHE Types
 *
 * Payment protocol for confidential tokens using FHE (Fully Homomorphic Encryption)
 */

export interface FHEPaymentRequirement {
  scheme: 'fhe-transfer'
  network: string
  chainId: number
  payTo: `0x${string}`
  maxAmountRequired: string  // In token decimals (e.g., "1000000" for 1 token with 6 decimals)
  asset: `0x${string}`       // ERC7984 token contract address
  resource: string
  description: string
  mimeType: string
  maxTimeoutSeconds: number
}

export interface FHEPaymentPayload {
  x402Version: 1
  scheme: 'fhe-transfer'
  network: string
  chainId: number
  payload: {
    // Transaction proof
    txHash: `0x${string}`
    // Transfer details
    from: `0x${string}`
    to: `0x${string}`
    // Encrypted amount handle from the transfer event
    handle: `0x${string}`
    // Decrypted amount (claimed by user)
    cleartext: string
    // User's signature for decryption verification
    decryptionSignature: {
      signature: string
      publicKey: string
      privateKey: string  // Needed for server-side verification
      userAddress: `0x${string}`
      contractAddresses: `0x${string}`[]
      startTimestamp: number
      durationDays: number
    }
  }
}

export interface FHEPaymentVerifyResult {
  isValid: boolean
  invalidReason?: string
  txHash?: `0x${string}`
  amount?: string
}

export interface FHEPaymentSettleResult {
  success: boolean
  txHash?: `0x${string}`
  amount?: string
  error?: string
}

// Event type from ERC7984 ConfidentialTransfer
export interface ConfidentialTransferEvent {
  from: `0x${string}`
  to: `0x${string}`
  amount: `0x${string}`  // This is the encrypted handle, not the actual amount
}
