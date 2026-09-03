export type SlipProvider = 'CBE' | 'TELEBIRR' | 'AWASH' | 'ABYSSINIA' | 'DASHEN' | 'UNKNOWN';

export interface ExtractedSlipData {
  provider: SlipProvider;
  transactionRef: string | null;   // Primary TXN/reference number
  receiptUrl: string | null;       // URL decoded from QR (if any)
  amount: number | null;           // Amount detected via OCR
  receiverAccount: string | null;  // Destination account
  receiverName: string | null;
  senderName: string | null;
  date: string | null;
  rawText: string;                 // Full OCR text for audit
  qrData: string | null;           // Raw QR payload
  confidence: number;              // 0-1, how confident extraction was
}

export type VerificationStatus =
  | 'VERIFIED'      // Online verification succeeded
  | 'AUTO_APPROVED' // Heuristic check passed (no API, but looks valid)
  | 'PENDING_MANUAL'// Could not auto-verify; needs human review
  | 'FAILED'        // Verification definitively failed (wrong amount, duplicate, etc.)
  | 'DUPLICATE';    // Same TXN ref already used

export interface VerificationResult {
  status: VerificationStatus;
  extractedData: ExtractedSlipData;
  reason: string;
  autoApprove: boolean;           // true → immediately mark APPROVED
  verifiedAmount: number | null;
  duplicatePaymentId: string | null;
}
