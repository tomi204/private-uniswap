"use client"

import { useCallback, useState } from "react"
import { ethers } from "ethers"
import type { FhevmInstance } from "fhevm-sdk"
import {
  useFHEEncryption,
  useFHEDecrypt,
  useInMemoryStorage,
  getEncryptionMethod,
  FhevmDecryptionSignature,
} from "fhevm-sdk"
import { useWagmiEthers } from "../wagmi/useWagmiEthers"
import { useDeployedContractInfo } from "../helper"
import type { AllowedChainIds } from "~~/utils/helper/networks"
import {
  parsePaymentRequirements,
  createPaymentPayload,
  fetchWithPaymentHeader,
  extractTransferHandle,
  type FHEPaymentRequirement,
  type FHEPaymentPayload,
} from "~~/lib/x402-fhe"

export interface UseX402PaymentParams {
  instance: FhevmInstance | undefined
  initialMockChains?: Readonly<Record<number, string>>
}

export interface PaymentState {
  status: 'idle' | 'fetching' | 'payment_required' | 'transferring' | 'decrypting' | 'completing' | 'success' | 'error'
  message: string
  requirement?: FHEPaymentRequirement
  txHash?: `0x${string}`
  response?: Response
  data?: unknown
  error?: string
}

export const useX402Payment = (params: UseX402PaymentParams) => {
  const { instance, initialMockChains } = params
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage()
  const { chainId, ethersSigner, ethersReadonlyProvider } = useWagmiEthers(initialMockChains)

  const allowedChainId = typeof chainId === "number" ? (chainId as AllowedChainIds) : undefined
  const { data: erc7984 } = useDeployedContractInfo({ contractName: "ERC7984Example", chainId: allowedChainId })

  const [state, setState] = useState<PaymentState>({ status: 'idle', message: '' })

  const { encryptWith } = useFHEEncryption({
    instance,
    ethersSigner: ethersSigner as ethers.JsonRpcSigner | undefined,
    contractAddress: erc7984?.address,
  })

  /**
   * Fetch a protected resource with automatic FHE payment handling
   */
  const fetchWithPayment = useCallback(async (
    url: string,
    amount: number,
    options: RequestInit = {}
  ): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    if (!instance || !ethersSigner || !erc7984 || !ethersReadonlyProvider) {
      return { success: false, error: 'Wallet or FHEVM not connected' }
    }

    try {
      // 1. First request - check if payment is required
      setState({ status: 'fetching', message: 'Checking resource...' })
      const initialResponse = await fetch(url, options)

      if (initialResponse.status !== 402) {
        // No payment required
        const data = await initialResponse.json()
        setState({ status: 'success', message: 'Resource accessed', data })
        return { success: true, data }
      }

      // 2. Parse payment requirements
      const requirements = parsePaymentRequirements(initialResponse)
      if (requirements.length === 0) {
        throw new Error('No payment requirements in 402 response')
      }
      const requirement = requirements[0]
      setState({ status: 'payment_required', message: 'Payment required', requirement })

      // 3. Make the confidential transfer
      setState({ status: 'transferring', message: `Transferring ${amount} tokens...` })

      // Get encryption method from ABI
      const functionAbi = erc7984.abi.find(
        (item: { type: string; name?: string }) => item.type === "function" && item.name === "confidentialTransfer"
      ) as { inputs?: Array<{ internalType?: string }> } | undefined
      const inputs = functionAbi?.inputs || []
      const amountInput = inputs.find((input: { internalType?: string }) => input.internalType?.includes("externalEuint64"))
      const method = amountInput?.internalType ? getEncryptionMethod(amountInput.internalType) : undefined

      if (!method) {
        throw new Error('Could not determine encryption method')
      }

      // Encrypt amount
      const enc = await encryptWith((builder: any) => {
        builder[method](amount)
      })
      if (!enc) {
        throw new Error('Encryption failed')
      }

      // Make transfer
      const contract = new ethers.Contract(erc7984.address, erc7984.abi, ethersSigner)
      const transferFn = contract.getFunction("confidentialTransfer(address,bytes32,bytes)")
      const tx = await transferFn(requirement.payTo, enc.handles[0], enc.inputProof)
      const receipt = await tx.wait()

      const txHash = receipt.hash as `0x${string}`
      setState({ status: 'decrypting', message: 'Preparing payment proof...', txHash })

      // 4. Get decryption signature
      const userAddress = await ethersSigner.getAddress()
      const sig = await FhevmDecryptionSignature.loadOrSign(
        instance,
        [erc7984.address],
        ethersSigner,
        fhevmDecryptionSignatureStorage
      )

      if (!sig) {
        throw new Error('Failed to create decryption signature')
      }

      // 5. Create payment payload
      // Note: We use the amount we sent as cleartext (user claims this amount)
      const paymentPayload = await createPaymentPayload(
        txHash,
        receipt,
        erc7984.address,
        BigInt(amount),
        sig,
        chainId!,
        requirement.network
      )

      // 6. Retry request with payment
      setState({ status: 'completing', message: 'Completing payment...', txHash })
      const paidResponse = await fetchWithPaymentHeader(url, paymentPayload, options)

      if (!paidResponse.ok) {
        const errorData = await paidResponse.json().catch(() => ({}))
        throw new Error(errorData.reason || errorData.error || `Payment failed: ${paidResponse.status}`)
      }

      const data = await paidResponse.json()
      setState({ status: 'success', message: 'Payment complete!', data, txHash, response: paidResponse })
      return { success: true, data }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setState({ status: 'error', message: errorMessage, error: errorMessage })
      return { success: false, error: errorMessage }
    }
  }, [instance, ethersSigner, erc7984, ethersReadonlyProvider, chainId, encryptWith, fhevmDecryptionSignatureStorage])

  const reset = useCallback(() => {
    setState({ status: 'idle', message: '' })
  }, [])

  return {
    fetchWithPayment,
    reset,
    state,
    isReady: Boolean(instance && ethersSigner && erc7984),
  }
}
