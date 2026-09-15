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

export interface ExtractedInvoiceData {
  vendor?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  currency?: string;
}

export interface Document {
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
