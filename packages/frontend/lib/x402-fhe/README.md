# x402-FHE: Confidential Token Payments

HTTP 402 payment protocol implementation for ERC7984 confidential tokens using Fully Homomorphic Encryption (FHE).

## Overview

x402-FHE enables payment-gated resources using confidential token transfers. Unlike traditional x402 implementations that use EIP-3009 signatures, this uses actual on-chain FHE transfers where the payment amount remains encrypted.

## Flow

```
1. Client → GET /api/premium-data
2. Server → 402 Payment Required + X-Accept-Payment header
3. Client → Parse requirements, make confidentialTransfer on-chain
4. Client → Sign decryption authorization, create payment proof
5. Client → Retry GET with x-payment header containing:
   - txHash
   - handle (encrypted amount)
   - cleartext (claimed amount)
   - decryptionSignature
6. Server → Verify transfer on-chain, validate claimed amount
7. Server → 200 OK + premium content
```

## Usage

### Server Side (API Route)

```typescript
import { requireFHEPayment, type FHEPaymentRequirement } from '~~/lib/x402-fhe'

const requirement: Omit<FHEPaymentRequirement, 'resource'> = {
  scheme: 'fhe-transfer',
  network: 'fhevm-local',
  chainId: 31337,
  payTo: '0x...' as `0x${string}`,
  maxAmountRequired: '1000000', // 1 token with 6 decimals
  asset: '0x...' as `0x${string}`,
  description: 'Premium access',
  mimeType: 'application/json',
  maxTimeoutSeconds: 300,
}

export async function GET(request: NextRequest) {
  const paymentResponse = await requireFHEPayment(request, requirement, RPC_URL)
  if (paymentResponse) return paymentResponse

  // Payment valid - return content
  return NextResponse.json({ secret: 'Premium data!' })
}
```

### Client Side (React Hook)

```typescript
import { useX402Payment } from '~~/hooks/x402'

function PremiumContent() {
  const { fetchWithPayment, state, isReady } = useX402Payment({
    instance: fhevmInstance,
  })

  const handlePurchase = async () => {
    const result = await fetchWithPayment('/api/premium-data', 1000000) // amount in smallest units
    if (result.success) {
      console.log('Got premium data:', result.data)
    }
  }

  return (
    <div>
      <p>Status: {state.status}</p>
      <button onClick={handlePurchase} disabled={!isReady}>
        Buy Premium Access
      </button>
    </div>
  )
}
```

## Security Notes

1. **On-chain verification**: The server verifies the transfer transaction exists on-chain
2. **Handle matching**: The encrypted handle in the event must match the claimed handle
3. **Recipient verification**: Transfer must be to the correct merchant address
4. **Signature verification**: Decryption signature must be from the transfer sender
5. **Trustless amount verification**: Server uses FHEVM Node SDK to decrypt and verify the actual amount

## Server-Side Verification (Trustless)

The server uses `@zama-fhe/relayer-sdk/node` directly to decrypt and verify:

```typescript
import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/node'

const instance = await createInstance(SepoliaConfig)

// Decrypt using user's signature
const decrypted = await instance.userDecrypt(
  [{ handle, contractAddress }],
  sig.privateKey,
  sig.publicKey,
  sig.signature,
  sig.contractAddresses,
  sig.userAddress,
  sig.startTimestamp,
  sig.durationDays
)

const actualAmount = decrypted[handle.toLowerCase()]
// Now verify actualAmount >= requiredAmount
```

This ensures the user cannot lie about the payment amount.

## Environment Variables

```bash
# Client-side (public)
NEXT_PUBLIC_MERCHANT_ADDRESS="0x..."  # Merchant receiving payments
NEXT_PUBLIC_RPC_URL="http://..."      # RPC for on-chain verification
NEXT_PUBLIC_CHAIN_ID="31337"          # Chain ID
NEXT_PUBLIC_TOKEN_ADDRESS="0x..."     # ERC7984 token contract

# Server-side (for trustless verification)
FHEVM_RELAYER_URL="https://relayer.sepolia.zama.ai"
FHEVM_DECRYPTION_CONTRACT="0x..."
FHEVM_INPUT_VERIFICATION_CONTRACT="0x..."
FHEVM_KMS_CONTRACT="0x..."
FHEVM_INPUT_VERIFIER_CONTRACT="0x..."
FHEVM_ACL_CONTRACT="0x..."
FHEVM_GATEWAY_CHAIN_ID="11155111"
```
