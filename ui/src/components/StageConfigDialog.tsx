import { useState, useMemo } from "react";
import type { TableInfo } from "../hooks/useDuckDB.js";
import { generateStageSQL, type StageConfig } from "../utils/sqlGenerator.js";

interface StageConfigDialogProps {
  stageType: string;
  nodeId: string;
  tables: TableInfo[];
  onRun: (sql: string, resultName: string, stageConfig?: StageConfig) => void;
  onClose: () => void;
}

export default function StageConfigDialog({
  stageType,
  nodeId,
  tables,
  onRun,
  onClose,
}: StageConfigDialogProps) {
  const type = stageType.toUpperCase();
  const defaultResultName = `stage_${type.toLowerCase()}_${nodeId.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const [resultName, setResultName] = useState(defaultResultName);
  const [error, setError] = useState<string | null>(null);

  // FILTER
  const [filterTable, setFilterTable] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [filterOperator, setFilterOperator] = useState("=");
  const [filterValue, setFilterValue] = useState("");

  // JOIN
  const [joinType, setJoinType] = useState("INNER");
  const [leftTable, setLeftTable] = useState("");
  const [rightTable, setRightTable] = useState("");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");

  // UNION
  const [unionTables, setUnionTables] = useState<string[]>([]);
  const [unionType, setUnionType] = useState("UNION");

  // GROUP
  const [groupTable, setGroupTable] = useState("");
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [aggFn, setAggFn] = useState("COUNT");
  const [aggColumn, setAggColumn] = useState("");
  const [aggAlias, setAggAlias] = useState("");
  const [aggregations, setAggregations] = useState<
    Array<{ fn: string; column: string; alias?: string }>
  >([]);

  // SELECT
  const [selectTable, setSelectTable] = useState("");
  const [selectColumns, setSelectColumns] = useState<string[]>([]);

  // SORT
  const [sortTable, setSortTable] = useState("");
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState("ASC");

  // CUSTOM
  const [customSql, setCustomSql] = useState("");

  const tableNames = useMemo(() => tables.map((t) => t.name), [tables]);

  const columnsByTable = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of tables) map.set(t.name, t.data.columns);
    return map;
  }, [tables]);

  const handleRun = () => {
    setError(null);
    try {
      let config: StageConfig;
      switch (type) {
        case "FILTER":
          config = {
            type,
            resultName,
            table: filterTable,
            column: filterColumn,
            operator: filterOperator,
            value: filterValue,
          };
          break;
        case "JOIN":
          config = { type, resultName, leftTable, rightTable, leftKey, rightKey, joinType };
          break;
        case "UNION":
          config = { type, resultName, unionTables, unionType };
          break;
        case "GROUP":
          config = {
            type,
            resultName,
            groupTable,
            groupByColumns,
            aggregations,
          };
          break;
        case "SELECT":
          config = { type, resultName, selectTable, selectColumns };
          break;
        case "SORT":
          config = { type, resultName, sortTable, sortColumn, sortDirection };
          break;
        case "CUSTOM":
          config = { type, resultName, sql: customSql };
          break;
        default:
          throw new Error(`Unknown stage type: ${type}`);
      }
      const sql = generateStageSQL(config);
      onRun(sql, resultName, config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderFields = () => {
    switch (type) {
      case "FILTER": {
        const cols = filterTable ? (columnsByTable.get(filterTable) ?? []) : [];
        return (
          <>
            <Field label="Table">
              <select value={filterTable} onChange={(e) => { setFilterTable(e.target.value); setFilterColumn(""); }}>
                <option value="">Select table...</option>
                {tableNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Column">
              <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)} disabled={!filterTable}>
                <option value="">Select column...</option>
                {cols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Operator">
              <select value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)}>
                {["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "NOT IN"].map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </Field>
            <Field label="Value">
              <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="e.g. 25 or 'active'" />
            </Field>
          </>
        );
      }

      case "JOIN": {
        const leftCols = leftTable ? (columnsByTable.get(leftTable) ?? []) : [];
        const rightCols = rightTable ? (columnsByTable.get(rightTable) ?? []) : [];
        return (
          <>
            <Field label="Join Type">
              <select value={joinType} onChange={(e) => setJoinType(e.target.value)}>
                {["INNER", "LEFT", "RIGHT", "FULL OUTER"].map((jt) => (
                  <option key={jt} value={jt}>{jt}</option>
                ))}
              </select>
            </Field>
            <Field label="Left Table">
              <select value={leftTable} onChange={(e) => { setLeftTable(e.target.value); setLeftKey(""); }}>
                <option value="">Select table...</option>
                {tableNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Left Key">
              <select value={leftKey} onChange={(e) => setLeftKey(e.target.value)} disabled={!leftTable}>
                <option value="">Select column...</option>
                {leftCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Right Table">
              <select value={rightTable} onChange={(e) => { setRightTable(e.target.value); setRightKey(""); }}>
                <option value="">Select table...</option>
                {tableNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Right Key">
              <select value={rightKey} onChange={(e) => setRightKey(e.target.value)} disabled={!rightTable}>
                <option value="">Select column...</option>
                {rightCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </>
        );
      }

      case "UNION":
        return (
          <>
            <Field label="Union Type">
              <select value={unionType} onChange={(e) => setUnionType(e.target.value)}>
                <option value="UNION">UNION (distinct)</option>
                <option value="UNION ALL">UNION ALL</option>
              </select>
            </Field>
            <Field label="Tables (select 2+)">
              <div className="checkbox-list">
                {tableNames.map((n) => (
                  <label key={n} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={unionTables.includes(n)}
                      onChange={(e) =>
                        setUnionTables((prev) =>
                          e.target.checked ? [...prev, n] : prev.filter((t) => t !== n),
                        )
                      }
                    />
                    {n}
                  </label>
                ))}
              </div>
            </Field>
          </>
        );

      case "GROUP": {
        const cols = groupTable ? (columnsByTable.get(groupTable) ?? []) : [];
        return (
          <>
            <Field label="Table">
              <select value={groupTable} onChange={(e) => { setGroupTable(e.target.value); setGroupByColumns([]); }}>
                <option value="">Select table...</option>
                {tableNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Group By Columns">
              <div className="checkbox-list">
                {cols.map((c) => (
                  <label key={c} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={groupByColumns.includes(c)}
                      onChange={(e) =>
                        setGroupByColumns((prev) =>
                          e.target.checked ? [...prev, c] : prev.filter((x) => x !== c),
                        )
                      }
                    />
                    {c}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Aggregations">
              <div className="agg-add-row">
                <select value={aggFn} onChange={(e) => setAggFn(e.target.value)}>
                  {["COUNT", "SUM", "AVG", "MIN", "MAX"].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <select value={aggColumn} onChange={(e) => setAggColumn(e.target.value)}>
                  <option value="">Column...</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={aggAlias} onChange={(e) => setAggAlias(e.target.value)} placeholder="Alias" style={{ width: 80 }} />
                <button
                  type="button"
                  className="agg-add-btn"
                  disabled={!aggColumn}
                  onClick={() => {
                    if (!aggColumn) return;
                    setAggregations((prev) => [...prev, { fn: aggFn, column: aggColumn, alias: aggAlias || undefined }]);
                    setAggColumn("");
                    setAggAlias("");
                  }}
                >
                  +
                </button>
              </div>
              {aggregations.length > 0 && (
                <div className="agg-list">
                  {aggregations.map((a, i) => (
                    <div key={i} className="agg-item">
                      <span>{a.fn}({a.column}){a.alias ? ` AS ${a.alias}` : ""}</span>
                      <button type="button" onClick={() => setAggregations((prev) => prev.filter((_, j) => j !== i))}>
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </>
        );
      }

      case "SELECT": {
        const cols = selectTable ? (columnsByTable.get(selectTable) ?? []) : [];
        return (
          <>
            <Field label="Table">
              <select value={selectTable} onChange={(e) => { setSelectTable(e.target.value); setSelectColumns([]); }}>
                <option value="">Select table...</option>
                {tableNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Columns">
              <div className="checkbox-list">
                {cols.map((c) => (
                  <label key={c} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectColumns.includes(c)}
                      onChange={(e) =>
                        setSelectColumns((prev) =>
                          e.target.checked ? [...prev, c] : prev.filter((x) => x !== c),
                        )
                      }
                    />
                    {c}
                  </label>
                ))}
              </div>
            </Field>
          </>
        );
      }

      case "SORT": {
        const cols = sortTable ? (columnsByTable.get(sortTable) ?? []) : [];
        return (
          <>
            <Field label="Table">
              <select value={sortTable} onChange={(e) => { setSortTable(e.target.value); setSortColumn(""); }}>
                <option value="">Select table...</option>
                {tableNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Column">
              <select value={sortColumn} onChange={(e) => setSortColumn(e.target.value)} disabled={!sortTable}>
                <option value="">Select column...</option>
                {cols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Direction">
              <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value)}>
                <option value="ASC">Ascending</option>
                <option value="DESC">Descending</option>
              </select>
            </Field>
          </>
        );
      }

      case "CUSTOM":
        return (
          <Field label="SQL Statement">
            <textarea
              value={customSql}
              onChange={(e) => setCustomSql(e.target.value)}
              placeholder="SELECT * FROM ..."
              rows={5}
            />
          </Field>
        );

      default:
        return <p>Unknown stage type: {type}</p>;
    }
  };

  return (
    <div className="stage-config-overlay" onClick={onClose}>
      <div className="stage-config-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="stage-config-header">
          <h3>Configure {type} Stage</h3>
          <button className="stage-config-close" onClick={onClose}>&times;</button>
        </div>

        <div className="stage-config-body">
          <Field label="Result table name">
            <input value={resultName} onChange={(e) => setResultName(e.target.value)} />
          </Field>

          {renderFields()}

          {error && <div className="stage-config-error">{error}</div>}
        </div>

        <div className="stage-config-footer">
          <button className="stage-config-cancel" onClick={onClose}>Cancel</button>
          <button className="stage-config-run" onClick={handleRun}>Run</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="stage-config-field">
      <label>{label}</label>
      {children}
    </div>
  );
}
