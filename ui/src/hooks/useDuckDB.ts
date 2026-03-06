import { useRef, useState, useCallback, useEffect } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
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
        row[col] = vec?.get(i);
      }
      rows.push(row);
    }
    return { columns, rows };
  };

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

    dbRef.current = db;
    connRef.current = await db.connect();
    setReady(true);
  }, []);

  // Initialize DuckDB on mount so engine is ready before first upload
  useEffect(() => {
    ensureInit()
      .then(() => setInitError(null))
      .catch((err) => setInitError(err instanceof Error ? err.message : String(err)));
  }, [ensureInit]);

  // Keep registered file buffers alive so DuckDB's virtual FS can read them (avoid GC)
  const fileBuffersRef = useRef<Map<string, Uint8Array>>(new Map());

  const loadCSV = useCallback(
    async (file: File): Promise<string | null> => {
      setError(null);
      setLoading(true);

      try {
        await ensureInit();
        const db = dbRef.current!;
        const conn = connRef.current!;

        const name = file.name
          .replace(/\.csv$/i, "")
          .replace(/[^a-zA-Z0-9_]/g, "_");
        const internalFileName = `table_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.csv`;

        // Use registerFileText + insertCSVFromPath (documented path); avoid read_csv_auto which
        // can fail with "No files found" when the virtual FS isn't visible to the SQL engine.
        const text = await file.text();
        await db.registerFileText(internalFileName, text);
        await conn.query(`DROP TABLE IF EXISTS "${name}"`);
        await conn.insertCSVFromPath(internalFileName, {
          name,
          header: true,
          detect: true,
          create: true,
        });

        const result = await conn.query(`SELECT * FROM "${name}" LIMIT 200`);
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
        setLoading(false);
        return name;
      } catch (err) {
        setError(String(err));
        setLoading(false);
        return null;
      }
    },
    [ensureInit],
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
    async (sql: string, resultName: string): Promise<string | null> => {
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
        return resultName;
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [],
  );

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
    executeQuery,
    executeStage,
  };
}
