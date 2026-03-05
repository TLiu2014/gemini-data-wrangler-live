import { useRef, useState, useCallback } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function useDuckDB() {
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  const [ready, setReady] = useState(false);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableName, setTableName] = useState<string | null>(null);

  const init = useCallback(async () => {
    if (dbRef.current) return;

    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);

    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    dbRef.current = db;
    connRef.current = await db.connect();
    setReady(true);
  }, []);

  const loadCSV = useCallback(
    async (file: File) => {
      if (!dbRef.current || !connRef.current) {
        await init();
      }
      const db = dbRef.current!;
      const conn = connRef.current!;

      const buffer = await file.arrayBuffer();
      const name = file.name.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9_]/g, "_");

      await db.registerFileBuffer(file.name, new Uint8Array(buffer));
      await conn.query(`CREATE OR REPLACE TABLE "${name}" AS SELECT * FROM read_csv_auto('${file.name}')`);

      setTableName(name);

      // Show first 100 rows
      await executeQuery(`SELECT * FROM "${name}" LIMIT 100`);
    },
    [init],
  );

  const executeQuery = useCallback(
    async (sql: string) => {
      if (!connRef.current) {
        setError("DuckDB not initialized. Load a CSV first.");
        return;
      }
      setError(null);

      try {
        const result = await connRef.current.query(sql);
        const columns = result.schema.fields.map((f) => f.name);
        const rows: Record<string, unknown>[] = [];

        for (let i = 0; i < result.numRows; i++) {
          const row: Record<string, unknown> = {};
          for (const col of columns) {
            const vec = result.getChild(col);
            row[col] = vec?.get(i);
          }
          rows.push(row);
        }

        setTableData({ columns, rows });
      } catch (err) {
        setError(String(err));
      }
    },
    [],
  );

  return { ready, tableData, tableName, error, init, loadCSV, executeQuery };
}
