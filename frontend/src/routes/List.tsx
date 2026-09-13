import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listDocuments, ApiError } from "../api/client";
import type { Document, DocumentType } from "../types";
import { useToastContext, kindFromStatus } from "../components/ToastProvider";
import { Heading } from "../components/ui/Heading";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { DocumentList, type ViewMode } from "../components/DocumentList";
import styles from "./List.module.scss";

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "", label: "All types" },
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "Receipt" },
  { value: "payment", label: "Payment" },
  { value: "bill", label: "Bill" },
  { value: "payslip", label: "Payslip" },
  { value: "settlement_slip", label: "Settlement Slip" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

export default function List() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { show } = useToastContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const qParam = searchParams.get("q") ?? "";
  const typeParam = searchParams.get("type") ?? "";
  const [qInput, setQInput] = useState(qParam);
  const [debouncedQ, setDebouncedQ] = useState(qParam);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedQ) next.set("q", debouncedQ);
    else next.delete("q");
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  useEffect(() => {
    setQInput(qParam);
  }, [qParam]);

  useEffect(() => {
    setLoading(true);
    const opts: { q?: string; document_type?: string } = {};
    if (qParam) opts.q = qParam;
    if (typeParam) opts.document_type = typeParam as DocumentType;
    listDocuments(20, 0, opts)
      .then((r) => {
        setDocs(r.documents);
        setTotal(r.total);
      })
      .catch((e) => {
        const err = e as ApiError | Error;
        const status = (err as ApiError).status ?? 500;
        const kind = kindFromStatus(status);
        show(kind, err.message || "Failed to list documents");
      })
      .finally(() => setLoading(false));
  }, [qParam, typeParam, show]);

  function onTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    const next = new URLSearchParams(searchParams);
    if (v) next.set("type", v);
    else next.delete("type");
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setQInput("");
    setDebouncedQ("");
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const [view, setView] = useState<ViewMode>("list");

  const hasFilters = Boolean(qParam || typeParam);

  return (
    <div className="page">
      <div className={styles['list-header']}>
        <Heading level={1} muted={`${total} total`}>Documents</Heading>
        <div className={styles['list-view-toggle']} role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? styles['list-toggle--active'] : styles['list-toggle']}
            onClick={() => setView("list")}
            type="button"
            title="List view"
          >
            ☰ List
          </button>
          <button
            role="tab"
            aria-selected={view === "grid"}
            className={view === "grid" ? styles['list-toggle--active'] : styles['list-toggle']}
            onClick={() => setView("grid")}
            type="button"
            title="Grid view"
          >
            ⊞ Grid
          </button>
        </div>
      </div>

      <div className={styles['list-filters']}>
        <Input
          aria-label="Search by document name"
          placeholder="Search by name..."
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <Select aria-label="Filter by document type" value={typeParam} onChange={onTypeChange}>
          {DOC_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button variant="secondary" size="md" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <DocumentList
        documents={docs}
        total={total}
        view={view}
        loading={loading}
        hasFilters={hasFilters}
        filterLabel={qParam || typeParam}
      />
    </div>
  );
}
