import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";
import { getSummary, exportSummary } from "../api/client";
import { Heading } from "../components/ui/Heading";
import { Button } from "../components/ui/Button";
import { Text } from "../components/ui/Text";
import { useTheme } from "../context/ThemeContext";
import styles from "./Dashboard.module.scss";
const COLORS_LIGHT = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];
const COLORS_DARK = [
  "#22d3ee",
  "#34d399",
  "#fcd34d",
  "#a78bfa",
  "#f9a8d4",
  "#67e8f9",
];
function formatType(v: string) {
  return v.replace(/_/g, " ");
}

export default function Dashboard() {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getSummary>
  > | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { theme } = useTheme();
  const COLORS = useMemo(() => (theme === "dark" ? COLORS_DARK : COLORS_LIGHT), [theme]);

  useEffect(() => {
    getSummary()
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, []);
  const download = useCallback(async (fmt: "pdf" | "csv") => {
    const blob = await exportSummary(fmt);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `claritydocs-summary.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);
  const handleDownloadCsv = useCallback(() => download("csv"), [download]);
  const handleDownloadPdf = useCallback(() => download("pdf"), [download]);
  if (err)
    return (
      <div className="page">
        <Text variant="muted" as="p">
          {err}
        </Text>
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Text variant="muted">Loading summary…</Text>
      </div>
    );
  return (
    <div className="page">
      <div className={styles["dashboard-header"]}>
        <Heading level={1}>30-Day Summary</Heading>
        <div className={styles["dashboard-actions"]}>
          <Button variant="secondary" size="md" onClick={handleDownloadCsv}>
            <i className="bi bi-filetype-csv" aria-hidden /> Download CSV
          </Button>
          <Button variant="primary" size="md" onClick={handleDownloadPdf}>
            <i className="bi bi-filetype-pdf" aria-hidden /> Download PDF
          </Button>
        </div>
      </div>

      <div className={styles["dashboard-stats"]}>
        <div className={styles["dashboard-stat"]}>
          <span className={styles["dashboard-stat-label"]}>Total Docs</span>
          <span className={styles["dashboard-stat-value"]}>
            {data.totalDocs}
          </span>
          <span className={styles["dashboard-stat-sub"]}>last 30 days</span>
        </div>
        <div className={styles["dashboard-stat"]}>
          <span className={styles["dashboard-stat-label"]}>Sum Total</span>
          <span className={styles["dashboard-stat-value"]}>
            {data.sumTotal.toFixed(2)}
          </span>
          <span className={styles["dashboard-stat-sub"]}>all currencies</span>
        </div>
        <div className={styles["dashboard-stat"]}>
          <span className={styles["dashboard-stat-label"]}>Avg Usage</span>
          <span className={styles["dashboard-stat-value"]}>
            {data.avgUsage.toFixed(2)}
          </span>
          <span className={styles["dashboard-stat-sub"]}>per document</span>
        </div>
        <div className={styles["dashboard-stat"]}>
          <span className={styles["dashboard-stat-label"]}>Authenticity</span>
          <span className={styles["dashboard-stat-value"]}>
            {(data.avgConfidence * 100).toFixed(1)}%
          </span>
          <span className={styles["dashboard-stat-sub"]}>avg confidence</span>
        </div>
      </div>

      <div className={styles["dashboard-grid2"]}>
        <div className={styles["dashboard-card"]}>
          <div className={styles["dashboard-card-title"]}>By Type — Count</div>
          {data.byType.length === 0 ? (
            <Text variant="muted">No data</Text>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.byType} margin={{ bottom: 40 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={theme === "dark" ? "#334155" : "#e5e7eb"}
                />
                <XAxis
                  dataKey="document_type"
                  tick={{
                    fontSize: 10,
                    fill: theme === "dark" ? "#94a3b8" : "#6b7280",
                  }}
                  interval={0}
                  tickFormatter={formatType as unknown as (v: string) => string}
                  angle={-20}
                  dy={10}
                  height={50}
                />
                <YAxis
                  tick={{
                    fontSize: 12,
                    fill: theme === "dark" ? "#94a3b8" : "#6b7280",
                  }}
                />
                <Tooltip
                  formatter={(v: unknown) =>
                    [v as number, "count"] as unknown as string
                  }
                  labelFormatter={(v) => formatType(String(v))}
                />
                <Bar dataKey="cnt" fill={COLORS[0]} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className={styles["dashboard-card"]}>
          <div className={styles["dashboard-card-title"]}>By Type — Sum</div>
          {data.byType.length === 0 ? (
            <Text variant="muted">No data</Text>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.byType.map((d) => ({
                    ...d,
                    name: formatType(d.document_type),
                  }))}
                  dataKey="sum"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  labelLine={false}
                  label={false}
                >
                  {data.byType.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: unknown) =>
                    [Number(v as number).toFixed(2), "sum"] as unknown as string
                  }
                />
                <Legend
                  formatter={(v: unknown) => formatType(String(v))}
                  wrapperStyle={
                    {
                      fontSize: 12,
                      color: theme === "dark" ? "#f1f5f9" : "#111827",
                    } as unknown as Record<string, unknown>
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className={styles["dashboard-card"]}>
        <div className={styles["dashboard-card-title"]}>
          Daily Trend (30 days)
        </div>
        {data.trend.length === 0 ? (
          <Text variant="muted">No data</Text>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.trend}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={theme === "dark" ? "#334155" : "#e5e7eb"}
              />
              <XAxis
                dataKey="date"
                tick={{
                  fontSize: 11,
                  fill: theme === "dark" ? "#94a3b8" : "#6b7280",
                }}
              />
              <YAxis
                tick={{
                  fontSize: 12,
                  fill: theme === "dark" ? "#94a3b8" : "#6b7280",
                }}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="cnt"
                stroke={COLORS[0]}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="sum"
                stroke={COLORS[1]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={styles["dashboard-card"]}>
        <div className={styles["dashboard-card-title"]}>Top Vendors</div>
        {data.topVendors.length === 0 ? (
          <Text variant="muted">No data</Text>
        ) : (
          <table className={styles["dashboard-table"]}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Count</th>
                <th>Sum</th>
              </tr>
            </thead>
            <tbody>
              {data.topVendors.map((v) => (
                <tr key={v.vendor}>
                  <td>{v.vendor}</td>
                  <td>{v.cnt}</td>
                  <td>{v.sum.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
