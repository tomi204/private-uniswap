// Types
export type {
  FHEPaymentRequirement,
  FHEPaymentPayload,
  FHEPaymentVerifyResult,
  FHEPaymentSettleResult,
  ConfidentialTransferEvent,
} from './types'

// Server-side middleware
export {
  createPaymentRequiredResponse,
  extractPaymentFromHeader,
  verifyTransferOnChain,
  requireFHEPayment,
  getPaymentInfo,
} from './middleware'

// Client-side helpers
export {
  parsePaymentRequirements,
  extractTransferHandle,
  createPaymentPayload,
  encodePaymentHeader,
  fetchWithPaymentHeader,
  completePaymentFlow,
} from './client'
export type { PaymentFlowParams } from './client'
