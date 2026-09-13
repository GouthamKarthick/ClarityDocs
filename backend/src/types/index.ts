export type DocumentStatus = "pending" | "processing" | "done" | "failed";

export type DocumentType =
  | "invoice"
  | "receipt"
  | "payment"
  | "bill"
  | "payslip"
  | "settlement_slip"
  | "other"
  | "unknown";

export interface DocumentRecord {
  id: string;
  name: string;
  path: string;
  status: DocumentStatus;
  document_type: DocumentType;
  data: ExtractedInvoiceData | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  name: string;
  path: string;
  status: DocumentStatus;
  document_type: DocumentType;
  data: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedInvoiceData {
  vendor?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  currency?: string;
}

export interface ExtractionResult {
  data: ExtractedInvoiceData;
  confidence: number;
  method: string;
  documentType: DocumentType;
  documentTypeConfidence: number;
}
