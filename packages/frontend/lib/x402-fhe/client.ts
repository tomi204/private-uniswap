"use client"

import { ethers } from 'ethers'
import type {
  FHEPaymentRequirement,
  FHEPaymentPayload,
} from './types'
import type { FhevmInstance } from 'fhevm-sdk'
import type { FhevmDecryptionSignature } from 'fhevm-sdk'

/**
 * Parse payment requirements from 402 response
 */
export function parsePaymentRequirements(response: Response): FHEPaymentRequirement[] {
  const header = response.headers.get('x-accept-payment')
  if (!header) {
    throw new Error('402 response missing X-Accept-Payment header')
  }
  return JSON.parse(header)
}

/**
 * Extract transfer handle from transaction receipt
 */
export function extractTransferHandle(
  receipt: ethers.TransactionReceipt,
  tokenAddress: string
): { from: string; to: string; handle: string } | null {
  // ERC7984 ConfidentialTransfer event signature
  const transferEventSignature = ethers.id('ConfidentialTransfer(address,address,uint256)')

  const transferLog = receipt.logs.find(
    log =>
      log.address.toLowerCase() === tokenAddress.toLowerCase() &&
      log.topics[0] === transferEventSignature
  )

  if (!transferLog) {
    return null
  }

  // ConfidentialTransfer(address indexed from, address indexed to, euint64 indexed amount)
  const from = ethers.getAddress('0x' + transferLog.topics[1]!.slice(26))
  const to = ethers.getAddress('0x' + transferLog.topics[2]!.slice(26))
  const handle = transferLog.topics[3]! // indexed

  return { from, to, handle }
}

/**
 * Create a payment payload after making a transfer
 */
export async function createPaymentPayload(
  txHash: `0x${string}`,
  receipt: ethers.TransactionReceipt,
  tokenAddress: string,
  cleartext: bigint,
  decryptionSignature: FhevmDecryptionSignature,
  chainId: number,
  network: string
): Promise<FHEPaymentPayload> {
  const transferInfo = extractTransferHandle(receipt, tokenAddress)
  if (!transferInfo) {
    throw new Error('Could not find ConfidentialTransfer event in transaction')
  }

  return {
    x402Version: 1,
    scheme: 'fhe-transfer',
    network,
    chainId,
    payload: {
      txHash,
      from: transferInfo.from as `0x${string}`,
      to: transferInfo.to as `0x${string}`,
      handle: transferInfo.handle as `0x${string}`,
      cleartext: cleartext.toString(),
      decryptionSignature: {
        signature: decryptionSignature.signature,
        publicKey: decryptionSignature.publicKey,
        privateKey: decryptionSignature.privateKey, // Needed for server verification
        userAddress: decryptionSignature.userAddress,
        contractAddresses: decryptionSignature.contractAddresses,
        startTimestamp: decryptionSignature.startTimestamp,
        durationDays: decryptionSignature.durationDays,
      },
    },
  }
}

/**
 * Encode payment payload for x-payment header
 */
export function encodePaymentHeader(payload: FHEPaymentPayload): string {
  return btoa(JSON.stringify(payload))
}

/**
 * Make a request with payment header
 */
export async function fetchWithPaymentHeader(
  url: string,
  paymentPayload: FHEPaymentPayload,
  options: RequestInit = {}
): Promise<Response> {
  const paymentHeader = encodePaymentHeader(paymentPayload)

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'x-payment': paymentHeader,
    },
  })
}

/**
 * Full payment flow helper
 *
 * Usage:
 * 1. First, make a request to the protected resource
 * 2. If you get 402, parse the requirements
 * 3. Make the confidential transfer to the merchant
 * 4. Wait for tx confirmation and get the receipt
 * 5. Decrypt the amount you sent
 * 6. Create the payment payload and retry
 */
export interface PaymentFlowParams {
  // The protected URL that returned 402
  url: string
  // Payment requirements from 402 response
  requirement: FHEPaymentRequirement
  // Transaction hash of the confidential transfer
  txHash: `0x${string}`
  // Transaction receipt
  receipt: ethers.TransactionReceipt
  // The decrypted amount (what you sent)
  cleartextAmount: bigint
  // Your decryption signature from FhevmDecryptionSignature
  decryptionSignature: FhevmDecryptionSignature
  // Original fetch options
  fetchOptions?: RequestInit
}

export async function completePaymentFlow(params: PaymentFlowParams): Promise<Response> {
  const {
    url,
    requirement,
    txHash,
    receipt,
    cleartextAmount,
    decryptionSignature,
    fetchOptions = {},
  } = params

  // Create payment payload
  const paymentPayload = await createPaymentPayload(
    txHash,
    receipt,
    requirement.asset,
    cleartextAmount,
    decryptionSignature,
    requirement.chainId,
    requirement.network
  )

  // Make the request with payment
  return fetchWithPaymentHeader(url, paymentPayload, fetchOptions)
}
