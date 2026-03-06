import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TableData } from "../hooks/useDuckDB.js";

interface ChartViewProps {
  config: { chartType: string; xKey: string; yKey: string } | null;
  data: TableData | null;
}

const COLORS = ["#4f46e5", "#0891b2", "#7c3aed", "#059669", "#d97706", "#dc2626", "#2563eb", "#db2777"];

export default function ChartView({ config, data }: ChartViewProps) {
  if (!config || !data) return null;

  const chartData = data.rows.map((row) => ({
    x: String(row[config.xKey] ?? ""),
    y: Number(row[config.yKey] ?? 0),
  }));

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={250}>
        {config.chartType === "bar" ? (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
            <XAxis dataKey="x" stroke="#888" fontSize={12} />
            <YAxis stroke="#888" fontSize={12} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", color: "#e0e0e0" }} />
            <Bar dataKey="y" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : config.chartType === "line" ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
            <XAxis dataKey="x" stroke="#888" fontSize={12} />
            <YAxis stroke="#888" fontSize={12} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", color: "#e0e0e0" }} />
            <Line type="monotone" dataKey="y" stroke="#4f46e5" strokeWidth={2} dot={{ fill: "#4f46e5" }} />
          </LineChart>
        ) : (
          <PieChart>
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", color: "#e0e0e0" }} />
            <Pie data={chartData} dataKey="y" nameKey="x" cx="50%" cy="50%" outerRadius={90} label>
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
