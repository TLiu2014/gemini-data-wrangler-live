import type { TableData } from "../hooks/useDuckDB.js";

interface DataTableProps {
  data: TableData | null;
  error: string | null;
}

export default function DataTable({ data, error }: DataTableProps) {
  if (error) {
    return <div className="data-table-error">{error}</div>;
  }

  if (!data) {
    return (
      <div className="data-table-placeholder">
        Upload a CSV or ask the agent to load data
      </div>
    );
  }

  return (
    <div className="data-table-wrap">
      <div className="data-table-info">
        {data.rows.length} rows &middot; {data.columns.length} columns
      </div>
      <table className="data-table">
        <thead>
          <tr>
            {data.columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {data.columns.map((col) => (
                <td key={col}>{String(row[col] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
