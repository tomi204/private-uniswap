import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { createInstance, type FhevmInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/node'
import type {
  FHEPaymentRequirement,
  FHEPaymentPayload,
  FHEPaymentVerifyResult,
} from './types'

// Singleton FHEVM instance
let fhevmInstance: FhevmInstance | null = null

async function getFhevmInstance(): Promise<FhevmInstance> {
  if (!fhevmInstance) {
    fhevmInstance = await createInstance(SepoliaConfig)
  }
  return fhevmInstance
}

/**
 * Create a 402 Payment Required response with FHE payment requirements
 */
export function createPaymentRequiredResponse(
  requirement: FHEPaymentRequirement,
  message?: string
): NextResponse {
  // Calculate price display (assuming 6 decimals like USDC)
  const decimals = 6
  const price = (parseInt(requirement.maxAmountRequired) / Math.pow(10, decimals)).toFixed(2)

  return new NextResponse(
    JSON.stringify({
      message: message || 'Payment required to access this resource',
      price: `$${price}`,
      scheme: 'fhe-transfer',
    }),
    {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'X-Accept-Payment': JSON.stringify([requirement]),
      },
    }
  )
}

/**
 * Extract and parse payment from x-payment header
 */
export function extractPaymentFromHeader(request: NextRequest): FHEPaymentPayload | null {
  const paymentHeader = request.headers.get('x-payment')
  if (!paymentHeader) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'))
  } catch (error) {
    console.error('Failed to parse payment header:', error)
    return null
  }
}

/**
 * Verify that a transfer transaction exists and matches requirements
 */
export async function verifyTransferOnChain(
  payment: FHEPaymentPayload,
  requirement: FHEPaymentRequirement,
  provider: ethers.Provider
): Promise<FHEPaymentVerifyResult> {
  try {
    // 1. Get the transaction receipt
    const receipt = await provider.getTransactionReceipt(payment.payload.txHash)
    if (!receipt) {
      return {
        isValid: false,
        invalidReason: 'Transaction not found on chain',
      }
    }

    // 2. Check transaction was successful
    if (receipt.status !== 1) {
      return {
        isValid: false,
        invalidReason: 'Transaction failed',
      }
    }

    // 3. Check the transaction was to the correct token contract
    if (receipt.to?.toLowerCase() !== requirement.asset.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'Transaction was not to the payment token contract',
      }
    }

    // 4. Parse the ConfidentialTransfer event
    // ERC7984 ConfidentialTransfer event signature: ConfidentialTransfer(address indexed from, address indexed to, uint256 amount)
    // Note: 'amount' here is the encrypted handle, not the actual value
    const transferEventSignature = ethers.id('ConfidentialTransfer(address,address,uint256)')

    const transferLog = receipt.logs.find(
      log => log.topics[0] === transferEventSignature
    )

    if (!transferLog) {
      return {
        isValid: false,
        invalidReason: 'ConfidentialTransfer event not found in transaction',
      }
    }

    // 5. Decode the event
    // ConfidentialTransfer(address indexed from, address indexed to, euint64 indexed amount)
    // All three are indexed, so they're in topics[1], topics[2], topics[3]
    const from = ethers.getAddress('0x' + transferLog.topics[1]!.slice(26))
    const to = ethers.getAddress('0x' + transferLog.topics[2]!.slice(26))
    const handle = transferLog.topics[3]! // The encrypted amount handle (indexed)

    // 6. Verify the transfer was to the merchant
    if (to.toLowerCase() !== requirement.payTo.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: `Transfer recipient (${to}) does not match required payTo (${requirement.payTo})`,
      }
    }

    // 7. Verify the sender matches the payment claim
    if (from.toLowerCase() !== payment.payload.from.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'Transfer sender does not match payment claim',
      }
    }

    // 8. Verify the handle matches
    if (handle.toLowerCase() !== payment.payload.handle.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'Transfer handle does not match payment claim',
      }
    }

    // 9. Verify the decryption signature is from the sender
    const signatureUserAddress = payment.payload.decryptionSignature.userAddress
    if (signatureUserAddress.toLowerCase() !== from.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: 'Decryption signature is not from the transfer sender',
      }
    }

    // 10. Verify the cleartext using FHEVM SDK (trustless verification)
    const claimedAmount = BigInt(payment.payload.cleartext)
    const requiredAmount = BigInt(requirement.maxAmountRequired)

    // Use the SDK directly to decrypt and verify
    const instance = await getFhevmInstance()
    const sig = payment.payload.decryptionSignature

    const decryptedValues = await instance.userDecrypt(
      [{ handle, contractAddress: requirement.asset }],
      sig.privateKey,
      sig.publicKey,
      sig.signature,
      sig.contractAddresses as string[],
      sig.userAddress,
      sig.startTimestamp,
      sig.durationDays
    )

    const actualAmount = decryptedValues[handle.toLowerCase() as `0x${string}`]
    if (typeof actualAmount !== 'bigint') {
      return {
        isValid: false,
        invalidReason: 'Failed to decrypt payment amount',
      }
    }

    // Verify claimed matches actual
    if (actualAmount !== claimedAmount) {
      return {
        isValid: false,
        invalidReason: `Claimed amount (${claimedAmount}) does not match decrypted amount (${actualAmount})`,
      }
    }

    // Check if amount meets requirement
    if (actualAmount < requiredAmount) {
      return {
        isValid: false,
        invalidReason: `Amount (${actualAmount}) is less than required (${requiredAmount})`,
      }
    }

    // All checks passed
    return {
      isValid: true,
      txHash: payment.payload.txHash,
      amount: actualAmount.toString(),
    }
  } catch (error) {
    console.error('Error verifying transfer on chain:', error)
    return {
      isValid: false,
      invalidReason: error instanceof Error ? error.message : 'Unknown verification error',
    }
  }
}

/**
 * Middleware helper to protect routes with x402-FHE payment verification
 * Returns null if payment is valid, or a Response if payment is required/invalid
 */
export async function requireFHEPayment(
  request: NextRequest,
  requirement: Omit<FHEPaymentRequirement, 'resource'>,
  rpcUrl: string
): Promise<NextResponse | null> {
  const payment = extractPaymentFromHeader(request)

  // No payment provided - return 402 with requirements
  if (!payment) {
    const url = new URL(request.url)
    const resourceUrl = `${url.protocol}//${url.host}${url.pathname}`

    return createPaymentRequiredResponse({
      ...requirement,
      resource: resourceUrl,
    } as FHEPaymentRequirement)
  }

  // Verify payment
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const url = new URL(request.url)
  const resourceUrl = `${url.protocol}//${url.host}${url.pathname}`

  const verifyResult = await verifyTransferOnChain(
    payment,
    {
      ...requirement,
      resource: resourceUrl,
    } as FHEPaymentRequirement,
    provider
  )

  if (!verifyResult.isValid) {
    return NextResponse.json(
      {
        error: 'Invalid payment',
        reason: verifyResult.invalidReason,
      },
      { status: 400 }
    )
  }

  // Payment is valid - allow the request to proceed
  return null
}

/**
 * Get payment info from a verified request (for use in API handlers)
 */
export function getPaymentInfo(request: NextRequest): FHEPaymentPayload | null {
  return extractPaymentFromHeader(request)
}
