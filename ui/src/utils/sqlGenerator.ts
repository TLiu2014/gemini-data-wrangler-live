export interface StageConfig {
  type: string;
  resultName: string;
  // FILTER
  table?: string;
  column?: string;
  operator?: string;
  value?: string;
  // JOIN
  leftTable?: string;
  rightTable?: string;
  leftKey?: string;
  rightKey?: string;
  joinType?: string;
  // UNION
  unionTables?: string[];
  unionType?: string;
  // GROUP
  groupTable?: string;
  groupByColumns?: string[];
  aggregations?: Array<{ fn: string; column: string; alias?: string }>;
  // SELECT
  selectTable?: string;
  selectColumns?: string[];
  // SORT
  sortTable?: string;
  sortColumn?: string;
  sortDirection?: string;
  // CUSTOM
  sql?: string;
}

export function generateStageSQL(config: StageConfig): string {
  let selectSql: string;

  switch (config.type.toUpperCase()) {
    case "FILTER": {
      if (!config.table || !config.column || !config.operator || config.value === undefined) {
        throw new Error("FILTER requires table, column, operator, and value");
      }
      const val =
        config.value !== "" && !isNaN(Number(config.value))
          ? config.value
          : `'${config.value.replace(/'/g, "''")}'`;
      selectSql = `SELECT * FROM "${config.table}" WHERE "${config.column}" ${config.operator} ${val}`;
      break;
    }

    case "JOIN": {
      if (!config.leftTable || !config.rightTable || !config.leftKey || !config.rightKey) {
        throw new Error("JOIN requires leftTable, rightTable, leftKey, and rightKey");
      }
      const joinType = config.joinType || "INNER";
      const keyword = joinType === "FULL OUTER" ? "FULL OUTER JOIN" : `${joinType} JOIN`;
      if (config.leftKey === config.rightKey) {
        selectSql = `SELECT l.*, r.* EXCLUDE ("${config.rightKey}") FROM "${config.leftTable}" l ${keyword} "${config.rightTable}" r USING ("${config.leftKey}")`;
      } else {
        selectSql = `SELECT l.*, r.* FROM "${config.leftTable}" l ${keyword} "${config.rightTable}" r ON l."${config.leftKey}" = r."${config.rightKey}"`;
      }
      break;
    }

    case "UNION": {
      if (!config.unionTables || config.unionTables.length < 2) {
        throw new Error("UNION requires at least 2 tables");
      }
      const kw = config.unionType === "UNION ALL" ? "UNION ALL" : "UNION";
      selectSql = config.unionTables.map((t) => `SELECT * FROM "${t}"`).join(` ${kw} `);
      break;
    }

    case "GROUP": {
      if (!config.groupTable || !config.groupByColumns?.length) {
        throw new Error("GROUP requires table and groupBy columns");
      }
      const groupBy = config.groupByColumns.map((c) => `"${c}"`).join(", ");
      let selectClause = groupBy;
      if (config.aggregations?.length) {
        const aggs = config.aggregations
          .map((a) => {
            const alias = a.alias ? ` AS "${a.alias}"` : "";
            return `${a.fn}("${a.column}")${alias}`;
          })
          .join(", ");
        selectClause = `${groupBy}, ${aggs}`;
      }
      selectSql = `SELECT ${selectClause} FROM "${config.groupTable}" GROUP BY ${groupBy}`;
      break;
    }

    case "SELECT": {
      if (!config.selectTable || !config.selectColumns?.length) {
        throw new Error("SELECT requires table and columns");
      }
      const cols = config.selectColumns.map((c) => `"${c}"`).join(", ");
      selectSql = `SELECT ${cols} FROM "${config.selectTable}"`;
      break;
    }

    case "SORT": {
      if (!config.sortTable || !config.sortColumn) {
        throw new Error("SORT requires table and column");
      }
      const dir = config.sortDirection || "ASC";
      selectSql = `SELECT * FROM "${config.sortTable}" ORDER BY "${config.sortColumn}" ${dir}`;
      break;
    }

    case "CUSTOM": {
      if (!config.sql?.trim()) {
        throw new Error("CUSTOM requires a SQL statement");
      }
      selectSql = config.sql.trim();
      break;
    }

    default:
      throw new Error(`Unsupported stage type: ${config.type}`);
  }

  return `CREATE OR REPLACE TABLE "${config.resultName}" AS ${selectSql}`;
}
