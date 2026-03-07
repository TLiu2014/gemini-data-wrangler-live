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

      await ensureInit();
      if (genRef.current !== capturedGen) return null; // stale – cleanup ran

      const db = dbRef.current!;
      const conn = connRef.current!;

      const internalFileName = `table_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.csv`;

      await db.registerFileText(internalFileName, csvText);
      if (genRef.current !== capturedGen) return null;

      await conn.query(`DROP TABLE IF EXISTS "${name}"`);
      if (genRef.current !== capturedGen) return null;

      await conn.insertCSVFromPath(internalFileName, {
        name,
        header: true,
        detect: true,
        create: true,
      });
      if (genRef.current !== capturedGen) return null;

      const result = await conn.query(`SELECT * FROM "${name}" LIMIT 200`);
      if (genRef.current !== capturedGen) return null;

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
    },
    [ensureInit],
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
        const result = await loadCSVInternal(name, csvText);
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
    getSchemas,
  };
}
