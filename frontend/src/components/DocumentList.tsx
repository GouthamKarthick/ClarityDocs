import type { Document } from "../types";
import { DocumentRow } from "./DocumentRow";
import { Text } from "./ui/Text";
import styles from "./DocumentList.module.scss";

export type ViewMode = "list" | "grid";

interface Props {
  documents: Document[];
  total: number;
  view: ViewMode;
  loading?: boolean;
  hasFilters?: boolean;
  filterLabel?: string;
}

export function DocumentList({ documents, view, loading, hasFilters, filterLabel }: Props) {

  if (loading) {
    return <div className={styles['document-list-skeleton']}><Text variant="muted">Loading…</Text></div>;
  }

  if (documents.length === 0) {
    return (
      <div className={styles['document-list-empty']}>
        <Text variant="muted">{hasFilters ? `No documents matching "${filterLabel}"` : "No documents yet — upload your first invoice or receipt."}</Text>
      </div>
    );
  }

  return (
    <div>
      <div className={view === "grid" ? styles['document-list-grid'] : styles['document-list-list']}>
        {documents.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </div>
    </div>
  );
}
