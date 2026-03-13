import { useRef, useState, useCallback, useEffect } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import * as arrow from "apache-arrow";
import Papa from "papaparse";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface TableInfo {
  id: string;
  name: string;
  data: TableData;
}

interface ParsedCsvResult {
  rows: Record<string, unknown>[];
  headers: string[];
}

export function useDuckDB() {
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parseResult = (result: any): TableData => {
    const columns: string[] = result.schema.fields.map((f: any) => f.name);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        const vec = result.getChild(col);
        let val = vec?.get(i);
        // DuckDB-WASM returns BigInt for integer types — convert to Number
        // so the value is JSON-serialisable (sent back to Gemini as tool result).
        if (typeof val === "bigint") {
          val = Number(val);
        }
        row[col] = val;
      }
      rows.push(row);
    }
    return { columns, rows };
  };

  const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const parseCsvText = useCallback((csvText: string): ParsedCsvResult => {
    const parsed = Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: true,
      transformHeader: (header) => header.trim(),
    });

    const fatalErrors = parsed.errors.filter((error) => error.code !== "UndetectableDelimiter");
    if (fatalErrors.length > 0) {
      throw new Error(fatalErrors[0]?.message ?? "Failed to parse CSV");
    }

    const headers = (parsed.meta.fields ?? []).map((header) => header.trim()).filter(Boolean);
    if (headers.length === 0) {
      throw new Error("CSV must include a header row");
    }

    const rows = parsed.data.map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const header of headers) {
        const value = row[header];
        normalized[header] = value === "" ? null : value;
      }
      return normalized;
    });

    return { rows, headers };
  }, []);

  const createEmptyTable = useCallback(async (tableName: string, headers: string[]) => {
    const conn = connRef.current;
    if (!conn) throw new Error("Database not ready");

    const columnsSql = headers
      .map((header) => `${quoteIdent(header)} VARCHAR`)
      .join(", ");
    await conn.query(`CREATE TABLE ${quoteIdent(tableName)} (${columnsSql})`);
  }, []);

  const ensureInit = useCallback(async () => {
    if (dbRef.current && connRef.current) return;

    const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
      mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
      eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
    };
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    await db.open({ path: ':memory:' });

    dbRef.current = db;
    connRef.current = await db.connect();
    setReady(true);
  }, []);

  const resetDatabase = useCallback(async () => {
    genRef.current++;
    try {
      await connRef.current?.close();
    } catch {}
    try {
      await dbRef.current?.terminate();
    } catch {}

    connRef.current = null;
    dbRef.current = null;
    setReady(false);
    setInitError(null);
    setLoading(false);
    setTables([]);
    setActiveTableId(null);
    setError(null);

    try {
      await ensureInit();
      setInitError(null);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    }
  }, [ensureInit]);

  // Generation counter: incremented on cleanup so in-flight loads from a
  // prior mount (React StrictMode double-invoke, HMR) silently abort instead
  // of racing with the fresh mount and leaving a stale error in state.
  const genRef = useRef(0);

  // Initialize DuckDB on mount; terminate on unmount/HMR so stale virtual-FS state is cleared
  useEffect(() => {
    ensureInit()
      .then(() => setInitError(null))
      .catch((err) => setInitError(err instanceof Error ? err.message : String(err)));

    return () => {
      genRef.current++; // invalidate any in-flight loadCSVInternal calls
      connRef.current?.close().catch(() => {});
      dbRef.current?.terminate().catch(() => {});
      connRef.current = null;
      dbRef.current = null;
      setReady(false);
      setTables([]);
      setActiveTableId(null);
      setError(null);
    };
  }, [ensureInit]);

  const loadCSVInternal = useCallback(
    async (name: string, csvText: string): Promise<string | null> => {
      // Capture generation BEFORE the first await so any cleanup that runs
      // during ensureInit's microtask yield is detected on the check below.
      const capturedGen = genRef.current;
      const isStale = () => genRef.current !== capturedGen;

      await ensureInit();
      if (isStale()) return null;

      const conn = connRef.current!;

      try {
        const { rows, headers } = parseCsvText(csvText);
        if (isStale()) return null;

        await conn.query(`DROP TABLE IF EXISTS "${name}"`);
        if (isStale()) return null;

        if (rows.length > 0) {
          const arrowTable = arrow.tableFromJSON(rows);
          await conn.insertArrowTable(arrowTable, { name, create: true });
        } else {
          await createEmptyTable(name, headers);
        }
        if (isStale()) return null;

        const result = await conn.query(`SELECT * FROM "${name}" LIMIT 200`);
        if (isStale()) return null;

        const data = parseResult(result);

        const tableInfo: TableInfo = { id: name, name, data };

        setTables((prev) => {
          const idx = prev.findIndex((t) => t.id === name);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = tableInfo;
            return updated;
          }
          return [...prev, tableInfo];
        });
        setActiveTableId(name);
        return name;
      } catch (err) {
        if (isStale()) return null;
        throw err;
      }
    },
    [createEmptyTable, ensureInit, parseCsvText],
  );

  const loadCSV = useCallback(
    async (file: File): Promise<string | null> => {
      setError(null);
      setLoading(true);

      try {
        const name = file.name
          .replace(/\.csv$/i, "")
          .replace(/[^a-zA-Z0-9_]/g, "_");
        const text = await file.text();
        const result = await loadCSVInternal(name, text);
        setLoading(false);
        return result;
      } catch (err) {
        setError(String(err));
        setLoading(false);
        return null;
      }
    },
    [loadCSVInternal],
  );

  const loadCSVFromText = useCallback(
    async (name: string, csvText: string): Promise<string | null> => {
      setError(null);
      setLoading(true);
      try {
        const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_");
        const result = await loadCSVInternal(safeName, csvText);
        setLoading(false);
        return result;
      } catch (err) {
        setError(String(err));
        setLoading(false);
        return null;
      }
    },
    [loadCSVInternal],
  );

  const executeQuery = useCallback(
    async (sql: string, resultName?: string) => {
      const conn = connRef.current;
      if (!conn) {
        setError("No data loaded yet. Upload a CSV first.");
        return;
      }
      setError(null);

      try {
        const result = await conn.query(sql);
        const data = parseResult(result);
        const id = resultName || `query_${Date.now()}`;

        const tableInfo: TableInfo = {
          id,
          name: resultName || "Query Result",
          data,
        };
        setTables((prev) => {
          const idx = prev.findIndex((t) => t.id === id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = tableInfo;
            return updated;
          }
          return [...prev, tableInfo];
        });
        setActiveTableId(id);
      } catch (err) {
        setError(String(err));
      }
    },
    [],
  );

  const executeStage = useCallback(
    async (sql: string, resultName: string): Promise<TableInfo | null> => {
      const conn = connRef.current;
      if (!conn) {
        setError("Database not ready");
        return null;
      }
      setError(null);
      try {
        await conn.query(sql);
        const result = await conn.query(`SELECT * FROM "${resultName}" LIMIT 200`);
        const data = parseResult(result);
        const tableInfo: TableInfo = { id: resultName, name: resultName, data };
        setTables((prev) => {
          const idx = prev.findIndex((t) => t.id === resultName);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = tableInfo;
            return updated;
          }
          return [...prev, tableInfo];
        });
        setActiveTableId(resultName);
        return tableInfo;
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [],
  );

  const dropTable = useCallback(
    async (tableName: string): Promise<boolean> => {
      const conn = connRef.current;
      if (!conn) return false;
      try {
        await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
        setTables((prev) => prev.filter((t) => t.name !== tableName));
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [],
  );

  const getSchemas = useCallback(async (): Promise<Record<string, string[]> | null> => {
    const conn = connRef.current;
    if (!conn || tables.length === 0) return null;
    const schemas: Record<string, string[]> = {};
    for (const t of tables) {
      try {
        const result = await conn.query(`DESCRIBE "${t.name}"`);
        const cols: string[] = [];
        for (let i = 0; i < result.numRows; i++) {
          const name = result.getChild("column_name")?.get(i);
          const type = result.getChild("column_type")?.get(i);
          if (name) cols.push(`${name} (${type ?? "unknown"})`);
        }
        schemas[t.name] = cols;
      } catch {
        schemas[t.name] = t.data.columns;
      }
    }
    return schemas;
  }, [tables]);

  const activeTable = tables.find((t) => t.id === activeTableId) ?? null;

  return {
    ready,
    initError,
    loading,
    tables,
    activeTable,
    activeTableId,
    setActiveTableId,
    error,
    loadCSV,
    loadCSVFromText,
    executeQuery,
    executeStage,
    dropTable,
    getSchemas,
    resetDatabase,
  };
}
