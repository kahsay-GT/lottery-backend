import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../../database/prisma.service';
import {
  ExtractedSlipData,
  SlipProvider,
  VerificationResult,
  VerificationStatus,
} from './slip-verify.types';

/**
 * SlipVerifyService
 *
 * Verification pipeline:
 *  1. QR scan (jsqr) → extract URL / ref from QR code
 *  2. OCR (tesseract.js) → extract text from image
 *  3. Parse extracted text for provider, amount, txn ref
 *  4. Duplicate-transaction check in DB
 *  5. (Optional) Call provider API if credentials configured
 *  6. Return VerificationResult with autoApprove decision
 */
@Injectable()
export class SlipVerifyService {
  private readonly logger = new Logger(SlipVerifyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Public entry point ──────────────────────────────────────────────────────

  /**
   * Fast QR-only scan — runs in ~100-300 ms (no OCR).
   * Returns the decoded URL/string if the image contains a QR code, otherwise null.
   * Called synchronously during slip upload so the link is stored immediately.
   */
  async quickScanQR(buffer: Buffer, mimeType: string): Promise<string | null> {
    try {
      const raw = await this.scanQR(buffer, mimeType);
      // Only return it if it looks like a URL (CBE, Telebirr, etc.)
      if (raw && (raw.startsWith('http://') || raw.startsWith('https://'))) {
        return raw;
      }
      return null;
    } catch {
      return null;
    }
  }

  async verifySlip(
    fileBuffer: Buffer,
    mimeType: string,
    paymentId: string,
    expectedAmount: number,
    clientId: string,
  ): Promise<VerificationResult> {
    this.logger.log(`Starting slip verification for payment ${paymentId}`);

    // Step 1: Extract data from image (QR + OCR)
    const extracted = await this.extractFromImage(fileBuffer, mimeType);
    this.logger.log(`Extracted: provider=${extracted.provider} ref=${extracted.transactionRef} amount=${extracted.amount}`);

    // Step 2: Duplicate check
    // Use transactionRef when available; fall back to receiptUrl so that re-scanning
    // the same CBE receipt URL (e.g. https://mbreciept.cbe.com.et/v2-xxx) is also rejected.
    const dedupeKey = extracted.transactionRef ?? extracted.receiptUrl;
    if (dedupeKey) {
      const duplicate = await this.checkDuplicate(dedupeKey, paymentId, clientId);
      if (duplicate) {
        const label = extracted.transactionRef
          ? `Transaction reference ${extracted.transactionRef}`
          : `Receipt URL ${extracted.receiptUrl}`;
        return {
          status: 'DUPLICATE',
          extractedData: extracted,
          reason: `${label} has already been used for payment ${duplicate.id}`,
          autoApprove: false,
          verifiedAmount: null,
          duplicatePaymentId: duplicate.id,
        };
      }
    }

    // Step 3: Online verification (if provider API is available)
    const onlineResult = await this.tryOnlineVerification(extracted, expectedAmount);
    if (onlineResult) return { ...onlineResult, extractedData: extracted };

    // Step 4: Heuristic verification (no API → trust OCR with confidence score)
    return this.heuristicVerify(extracted, expectedAmount, paymentId);
  }

  // ─── Image extraction ────────────────────────────────────────────────────────

  private async extractFromImage(
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedSlipData> {
    let qrData: string | null = null;
    let rawText = '';

    // Dynamically import heavy libs to avoid startup cost
    try {
      qrData = await this.scanQR(buffer, mimeType);
    } catch (e) {
      this.logger.warn('QR scan failed: ' + (e as Error).message);
    }

    try {
      rawText = await this.runOCR(buffer, mimeType);
    } catch (e) {
      this.logger.warn('OCR failed: ' + (e as Error).message);
      rawText = '';
    }

    return this.parseExtractedText(rawText, qrData);
  }

  // ─── QR code scanning ────────────────────────────────────────────────────────

  private async scanQR(buffer: Buffer, mimeType: string): Promise<string | null> {
    // For PDF: rasterize the first page to a PNG using pdftoppm (poppler-utils),
    // then continue with the same sharp → jsqr pipeline.
    let imageBuffer = buffer;
    if (mimeType === 'application/pdf') {
      imageBuffer = await this.rasterizePdfFirstPage(buffer);
    }

    // Convert to raw RGBA using sharp, then feed to jsqr
    const sharp = (await import('sharp')).default;
    const jsQR = (await import('jsqr')).default;

    const { data, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const code = jsQR(
      new Uint8ClampedArray(data.buffer),
      info.width,
      info.height,
    );

    if (code?.data) {
      this.logger.log(`QR decoded: ${code.data.slice(0, 80)}`);
      return code.data;
    }
    return null;
  }

  /**
   * Rasterize the first page of a PDF to a PNG buffer using pdftoppm.
   * pdftoppm is part of poppler-utils and available on the server.
   * Output resolution is 150 DPI — enough for QR code detection.
   */
  private async rasterizePdfFirstPage(pdfBuffer: Buffer): Promise<Buffer> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const os   = await import('os');
    const path = await import('path');
    const fs   = await import('fs');
    const execFileAsync = promisify(execFile);

    // Write PDF to a temp file (pdftoppm requires a file path input)
    const tmpDir     = os.tmpdir();
    const tmpPdf     = path.join(tmpDir, `slip-${Date.now()}.pdf`);
    const tmpOutBase = path.join(tmpDir, `slip-${Date.now()}-out`);

    try {
      fs.writeFileSync(tmpPdf, pdfBuffer);

      // pdftoppm -r 150 -png -f 1 -l 1 <input.pdf> <output-prefix>
      // produces <output-prefix>-1.png for page 1
      await execFileAsync('pdftoppm', [
        '-r', '150',     // 150 DPI — good balance of quality vs speed
        '-png',          // PNG output (sharp can read this directly)
        '-f', '1',       // first page only
        '-l', '1',       // last page = 1 (just page 1)
        tmpPdf,
        tmpOutBase,
      ]);

      // pdftoppm names output as <prefix>-000001.png (zero-padded)
      const candidates = [
        `${tmpOutBase}-1.png`,
        `${tmpOutBase}-01.png`,
        `${tmpOutBase}-001.png`,
        `${tmpOutBase}-0001.png`,
        `${tmpOutBase}-00001.png`,
        `${tmpOutBase}-000001.png`,
      ];
      const outputFile = candidates.find(f => fs.existsSync(f));
      if (!outputFile) throw new Error('pdftoppm did not produce output');

      const imageBuffer = fs.readFileSync(outputFile);
      return imageBuffer;
    } finally {
      // Clean up temp files
      try { fs.unlinkSync(tmpPdf); } catch { /* ignore */ }
      // Remove any pdftoppm output files
      try {
        const files = fs.readdirSync(tmpDir);
        const base  = path.basename(tmpOutBase);
        files.filter(f => f.startsWith(base)).forEach(f => {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
        });
      } catch { /* ignore */ }
    }
  }

  // ─── OCR ─────────────────────────────────────────────────────────────────────

  private async runOCR(buffer: Buffer, mimeType: string): Promise<string> {
    const { createWorker } = await import('tesseract.js');
    const sharp = (await import('sharp')).default;

    // For PDF, rasterize first page before OCR
    const imageBuffer = mimeType === 'application/pdf'
      ? await this.rasterizePdfFirstPage(buffer)
      : buffer;

    // Enhance image contrast for better OCR
    const enhanced = await sharp(imageBuffer)
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();

    const worker = await createWorker('eng');
    try {
      const { data: { text } } = await worker.recognize(enhanced);
      this.logger.debug(`OCR raw text (first 200): ${text.slice(0, 200)}`);
      return text;
    } finally {
      await worker.terminate();
    }
  }

  // ─── Text parsing ─────────────────────────────────────────────────────────────

  private parseExtractedText(rawText: string, qrData: string | null): ExtractedSlipData {
    const text = (rawText + ' ' + (qrData ?? '')).toLowerCase();

    // Detect provider
    const provider = this.detectProvider(text, qrData);

    // Extract transaction reference
    const transactionRef = this.extractTransactionRef(rawText, qrData, provider);

    // Extract amount (look for Ethiopian Birr amounts)
    const amount = this.extractAmount(rawText);

    // Extract URL from QR
    const receiptUrl = qrData && (qrData.startsWith('http://') || qrData.startsWith('https://'))
      ? qrData
      : null;

    // Extract account / name info
    const receiverAccount = this.extractAccountNumber(rawText);
    const receiverName    = this.extractName(rawText, 'receiver') ?? this.extractName(rawText, 'to');
    const senderName      = this.extractName(rawText, 'sender')   ?? this.extractName(rawText, 'from');

    // Date
    const date = this.extractDate(rawText);

    // Confidence: higher if we got a ref AND an amount
    const confidence =
      (transactionRef ? 0.4 : 0) +
      (amount !== null ? 0.3 : 0) +
      (qrData ? 0.2 : 0) +
      (provider !== 'UNKNOWN' ? 0.1 : 0);

    return {
      provider, transactionRef, receiptUrl, amount,
      receiverAccount, receiverName, senderName, date,
      rawText, qrData, confidence,
    };
  }

  // ── Provider detection ──────────────────────────────────────────────────────

  private detectProvider(text: string, qrData: string | null): SlipProvider {
    const q = (qrData ?? '').toLowerCase();

    if (text.includes('commercial bank of ethiopia') || text.includes('cbe') ||
        q.includes('cbe') || q.includes('combanketh'))    return 'CBE';
    if (text.includes('telebirr') || text.includes('ethio telecom') ||
        q.includes('telebirr'))                            return 'TELEBIRR';
    if (text.includes('awash bank') || text.includes('awash international'))
                                                           return 'AWASH';
    if (text.includes('abyssinia') || text.includes('bank of abyssinia'))
                                                           return 'ABYSSINIA';
    if (text.includes('dashen'))                           return 'DASHEN';
    return 'UNKNOWN';
  }

  // ── Transaction reference extraction ────────────────────────────────────────

  private extractTransactionRef(
    rawText: string,
    qrData: string | null,
    provider: SlipProvider,
  ): string | null {
    // Try QR data first (most reliable)
    if (qrData) {
      // CBE QR contains: https://...?refNo=XXXXX or similar
      const qrRef = qrData.match(/ref(?:no|erence|_no)?[=:\/\s]([A-Z0-9\-]{6,30})/i);
      if (qrRef) return qrRef[1].toUpperCase();

      // Telebirr QR: pure ref number
      const teleRef = qrData.match(/^([A-Z]{2,4}\d{8,20})$/i);
      if (teleRef) return teleRef[1].toUpperCase();

      // Generic: extract alphanumeric from short QR
      if (qrData.length < 50 && /^[A-Z0-9\-]+$/i.test(qrData.trim())) {
        return qrData.trim().toUpperCase();
      }
    }

    // OCR patterns by provider
    const patterns: RegExp[] = [
      // CBE patterns
      /(?:transaction|txn|receipt|ref(?:erence)?)\s*(?:no|number|id)?[:\s#]*([A-Z0-9\-]{8,30})/gi,
      /FT\d{12,20}/gi,          // CBE Futuristic Transfer
      /CBE[A-Z0-9]{8,20}/gi,
      // Telebirr patterns
      /TXN[:\s]*([A-Z0-9]{8,20})/gi,
      /(?:order|payment)\s*id[:\s]*([A-Z0-9\-]{6,25})/gi,
      // Generic numeric ref (12-20 digits)
      /\b(\d{12,20})\b/g,
    ];

    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (match && match[0]) {
        const cleaned = match[0]
          .replace(/(?:transaction|txn|receipt|reference|ref|no|number|id|ft|cbe|txn)[:\s#]*/gi, '')
          .trim()
          .toUpperCase();
        if (cleaned.length >= 6) return cleaned;
      }
    }

    return null;
  }

  // ── Amount extraction ────────────────────────────────────────────────────────

  private extractAmount(rawText: string): number | null {
    // Match patterns like: 1,500.00 or 1500 ETB or Birr 1,500.00
    const patterns = [
      /(?:amount|birr|etb|total|paid)[:\s]*([0-9,]+(?:\.[0-9]{1,2})?)/gi,
      /([0-9,]+(?:\.[0-9]{2}))\s*(?:birr|etb)/gi,
      /birr\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi,
    ];

    for (const pat of patterns) {
      const match = rawText.match(pat);
      if (match) {
        const numStr = match[0].replace(/[^0-9.]/g, '');
        const num = parseFloat(numStr);
        if (!isNaN(num) && num > 0 && num < 10_000_000) return num;
      }
    }
    return null;
  }

  // ── Account extraction ───────────────────────────────────────────────────────

  private extractAccountNumber(rawText: string): string | null {
    const match = rawText.match(/(?:account|acc|a\/c)[:\s]*(\d{8,20})/i);
    return match ? match[1] : null;
  }

  private extractName(rawText: string, type: string): string | null {
    const pat = new RegExp(`${type}[:\\s]+([A-Za-z]{2,} [A-Za-z]{2,}(?:\\s[A-Za-z]+)?)`, 'i');
    const match = rawText.match(pat);
    return match ? match[1].trim() : null;
  }

  private extractDate(rawText: string): string | null {
    const match = rawText.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
    return match ? match[1] : null;
  }

  // ─── Duplicate check ─────────────────────────────────────────────────────────

  private async checkDuplicate(
    dedupeKey: string,
    currentPaymentId: string,
    clientId: string,
  ): Promise<{ id: string } | null> {
    // Check verifiedTransactionRef in metadata
    const byRef = await this.prisma.paymentTransaction.findFirst({
      where: {
        id: { not: currentPaymentId },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
        metadata: {
          path: ['verifiedTransactionRef'],
          equals: dedupeKey,
        },
      },
      select: { id: true },
    });
    if (byRef) return byRef;

    // Check verifiedReceiptUrl in metadata (catches re-scanned receipt URLs like CBE's)
    const byUrl = await this.prisma.paymentTransaction.findFirst({
      where: {
        id: { not: currentPaymentId },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
        metadata: {
          path: ['verifiedReceiptUrl'],
          equals: dedupeKey,
        },
      },
      select: { id: true },
    });
    if (byUrl) return byUrl;

    // Also check notes field for stored refs
    const byNote = await this.prisma.paymentTransaction.findFirst({
      where: {
        id: { not: currentPaymentId },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
        notes: { contains: dedupeKey },
      },
      select: { id: true },
    });

    return byNote ?? null;
  }

  // ─── Online verification (provider APIs) ─────────────────────────────────────

  private async tryOnlineVerification(
    extracted: ExtractedSlipData,
    expectedAmount: number,
  ): Promise<Omit<VerificationResult, 'extractedData'> | null> {
    // CBE verification (requires CBE sandbox/production API key)
    if (extracted.provider === 'CBE') {
      const apiKey = process.env.CBE_VERIFY_API_KEY;
      if (apiKey && extracted.transactionRef) {
        return await this.verifyCBE(extracted, expectedAmount, apiKey);
      }
    }

    // Telebirr verification
    if (extracted.provider === 'TELEBIRR') {
      const apiKey = process.env.TELEBIRR_VERIFY_API_KEY;
      const appId  = process.env.TELEBIRR_APP_ID;
      if (apiKey && appId && extracted.transactionRef) {
        return await this.verifyTelebirr(extracted, expectedAmount, apiKey, appId);
      }
    }

    // Receipt URL verification (open the URL and validate)
    if (extracted.receiptUrl) {
      return await this.verifyReceiptUrl(extracted, expectedAmount);
    }

    return null; // No online verification available → fall through to heuristic
  }

  // ── CBE API verification ─────────────────────────────────────────────────────

  private async verifyCBE(
    extracted: ExtractedSlipData,
    expectedAmount: number,
    apiKey: string,
  ): Promise<Omit<VerificationResult, 'extractedData'> | null> {
    try {
      const axios = (await import('axios')).default;
      const resp = await axios.get(
        `${process.env.CBE_API_BASE_URL || 'https://api.combanketh.et/v1'}/transactions/${extracted.transactionRef}`,
        { headers: { 'X-Api-Key': apiKey }, timeout: 10_000 },
      );

      const txn = resp.data;
      const txnAmount   = Number(txn.amount ?? txn.transactionAmount ?? 0);
      const txnStatus   = (txn.status ?? txn.transactionStatus ?? '').toLowerCase();
      const txnReceiver = (txn.creditAccountNumber ?? txn.toAccount ?? '').trim();

      const amountMatch  = Math.abs(txnAmount - expectedAmount) < 1; // 1 Birr tolerance
      const statusOk     = txnStatus === 'success' || txnStatus === 'completed';
      const accountMatch = !extracted.receiverAccount ||
        txnReceiver.endsWith(extracted.receiverAccount.slice(-6));

      if (statusOk && amountMatch && accountMatch) {
        return {
          status: 'VERIFIED',
          reason: `CBE API verified: TXN ${extracted.transactionRef}, amount ${txnAmount} ETB`,
          autoApprove: true,
          verifiedAmount: txnAmount,
          duplicatePaymentId: null,
        };
      }

      return {
        status: 'FAILED',
        reason: `CBE verification failed: status=${txnStatus} amount=${txnAmount} expected=${expectedAmount}`,
        autoApprove: false,
        verifiedAmount: txnAmount,
        duplicatePaymentId: null,
      };
    } catch (e) {
      this.logger.warn(`CBE API error: ${(e as Error).message}`);
      return null; // Fall through to heuristic
    }
  }

  // ── Telebirr API verification ────────────────────────────────────────────────

  private async verifyTelebirr(
    extracted: ExtractedSlipData,
    expectedAmount: number,
    apiKey: string,
    appId: string,
  ): Promise<Omit<VerificationResult, 'extractedData'> | null> {
    try {
      const axios = (await import('axios')).default;
      const resp = await axios.post(
        `${process.env.TELEBIRR_API_BASE_URL || 'https://openapi.ethiotelecom.et'}/payment/v1/verify`,
        { outTradeNo: extracted.transactionRef, appId },
        { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 10_000 },
      );

      const result    = resp.data?.result ?? resp.data;
      const status    = (result?.tradeStatus ?? '').toLowerCase();
      const txnAmount = Number(result?.totalAmount ?? result?.amount ?? 0);
      const amountOk  = Math.abs(txnAmount - expectedAmount) < 1;

      if ((status === 'success' || status === 'trade_success') && amountOk) {
        return {
          status: 'VERIFIED',
          reason: `Telebirr verified: ref=${extracted.transactionRef}, amount=${txnAmount} ETB`,
          autoApprove: true,
          verifiedAmount: txnAmount,
          duplicatePaymentId: null,
        };
      }

      return {
        status: 'FAILED',
        reason: `Telebirr verification failed: status=${status} amount=${txnAmount}`,
        autoApprove: false,
        verifiedAmount: txnAmount,
        duplicatePaymentId: null,
      };
    } catch (e) {
      this.logger.warn(`Telebirr API error: ${(e as Error).message}`);
      return null;
    }
  }

  // ── Receipt URL verification ─────────────────────────────────────────────────

  private async verifyReceiptUrl(
    extracted: ExtractedSlipData,
    expectedAmount: number,
  ): Promise<Omit<VerificationResult, 'extractedData'> | null> {
    if (!extracted.receiptUrl) return null;

    try {
      const axios = (await import('axios')).default;
      const resp = await axios.get(extracted.receiptUrl, {
        timeout: 8_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LotteryVerify/1.0)' },
        maxRedirects: 3,
      });

      const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);

      // Look for amount in page
      const amountMatch = html.match(/(?:amount|birr|etb)[:\s"]*([0-9,]+(?:\.[0-9]{1,2})?)/i);
      const pageAmount  = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

      // Look for success keywords
      const successKeywords = ['successful', 'success', 'completed', 'approved', 'confirmed'];
      const pageSuccess     = successKeywords.some(k => html.toLowerCase().includes(k));

      if (pageSuccess && pageAmount && Math.abs(pageAmount - expectedAmount) < 1) {
        return {
          status: 'VERIFIED',
          reason: `Receipt URL verified: ${extracted.receiptUrl} — amount ${pageAmount} ETB`,
          autoApprove: true,
          verifiedAmount: pageAmount,
          duplicatePaymentId: null,
        };
      }

      // Partial confidence
      return {
        status: 'PENDING_MANUAL',
        reason: `Receipt URL loaded but could not confirm amount/status. Manual review needed.`,
        autoApprove: false,
        verifiedAmount: pageAmount,
        duplicatePaymentId: null,
      };
    } catch (e) {
      this.logger.warn(`Receipt URL fetch failed: ${(e as Error).message}`);
      return null;
    }
  }

  // ─── Heuristic verification (no API) ─────────────────────────────────────────

  private heuristicVerify(
    extracted: ExtractedSlipData,
    expectedAmount: number,
    paymentId: string,
  ): VerificationResult {
    const issues: string[] = [];
    let score = 0;

    // Transaction ref present?
    if (extracted.transactionRef) {
      score += 30;
    } else {
      issues.push('no transaction reference found in slip');
    }

    // Amount match?
    if (extracted.amount !== null) {
      const diff = Math.abs(extracted.amount - expectedAmount);
      if (diff < 1) {
        score += 40;
      } else if (diff < expectedAmount * 0.05) {
        score += 20;
        issues.push(`amount mismatch: found ${extracted.amount}, expected ${expectedAmount} ETB`);
      } else {
        score += 0;
        issues.push(`amount mismatch: found ${extracted.amount}, expected ${expectedAmount} ETB`);
      }
    } else {
      issues.push('could not read amount from slip');
      score += 10; // partial credit if image was clear enough for other data
    }

    // Provider recognized?
    if (extracted.provider !== 'UNKNOWN') score += 15;

    // QR present (indicates digital receipt, harder to fake)?
    if (extracted.qrData) score += 15;

    // High confidence from OCR?
    if (extracted.confidence > 0.7) score += 10;

    this.logger.log(`Heuristic score: ${score}/100 for payment ${paymentId}`);

    // Decision thresholds
    if (score >= 70) {
      return {
        status: 'AUTO_APPROVED',
        extractedData: extracted,
        reason: `Heuristic check passed (score ${score}/100). Provider: ${extracted.provider}, Ref: ${extracted.transactionRef ?? 'N/A'}.`,
        autoApprove: true,
        verifiedAmount: extracted.amount,
        duplicatePaymentId: null,
      };
    }

    if (score >= 40) {
      return {
        status: 'PENDING_MANUAL',
        extractedData: extracted,
        reason: `Partial confidence (score ${score}/100). Issues: ${issues.join('; ')}. Manual review required.`,
        autoApprove: false,
        verifiedAmount: extracted.amount,
        duplicatePaymentId: null,
      };
    }

    return {
      status: 'PENDING_MANUAL',
      extractedData: extracted,
      reason: `Low confidence (score ${score}/100). Issues: ${issues.join('; ')}. Manual review required.`,
      autoApprove: false,
      verifiedAmount: extracted.amount,
      duplicatePaymentId: null,
    };
  }
}
