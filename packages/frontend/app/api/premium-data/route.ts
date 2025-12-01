import { NextRequest, NextResponse } from 'next/server'
import {
  requireFHEPayment,
  getPaymentInfo,
  type FHEPaymentRequirement,
} from '~~/lib/x402-fhe'

// Configuration - these should come from env vars in production
const MERCHANT_ADDRESS = process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || '0x0000000000000000000000000000000000000000'
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545'
const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337')
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '0xC1A360D04A2eb19831cd12B51a7923aF8f70616D'

// Payment requirement for this endpoint
const paymentRequirement: Omit<FHEPaymentRequirement, 'resource'> = {
  scheme: 'fhe-transfer',
  network: 'fhevm-local',
  chainId: CHAIN_ID,
  payTo: MERCHANT_ADDRESS as `0x${string}`,
  maxAmountRequired: '1000000', // 1 token (assuming 6 decimals)
  asset: TOKEN_ADDRESS as `0x${string}`,
  description: 'Premium confidential data access',
  mimeType: 'application/json',
  maxTimeoutSeconds: 300,
}

export async function GET(request: NextRequest) {
  // Check for valid payment
  const paymentResponse = await requireFHEPayment(request, paymentRequirement, RPC_URL)

  // If payment is required or invalid, return the response
  if (paymentResponse) {
    return paymentResponse
  }

  // Payment is valid - get payment info for logging/tracking
  const paymentInfo = getPaymentInfo(request)

  // Return premium content
  return NextResponse.json({
    success: true,
    message: 'Welcome to premium confidential data!',
    data: {
      secret: 'This is confidential premium content',
      timestamp: new Date().toISOString(),
      paidWith: {
        txHash: paymentInfo?.payload.txHash,
        amount: paymentInfo?.payload.cleartext,
        from: paymentInfo?.payload.from,
      },
    },
  })
}
