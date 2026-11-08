import { q, assertIdent, DharaError } from "./oracle";
import { uuid } from "./security";

/**
 * Dhara — database engine.
 * Projects, tables (registry + DDL), auto-table-from-JSON, row CRUD with
 * PostgREST-style filters, and the RLS policy compiler (Supabase-like syntax).
 */

export type ColType =
  | "uuid"
  | "text"
  | "longtext"
  | "number"
  | "decimal"
  | "boolean"
  | "json"
  | "timestamp"
  | "date";

export interface ColumnDef {
  name: string;
  type: ColType;
  pk?: boolean;
  required?: boolean;
  unique?: boolean;
  defaultValue?: string | null;
}

export interface TableRegistryRow {
  ID: string;
  PROJECT_ID: string;
  NAME: string;
  PHYSICAL: string;
  COLUMNS: string | unknown;
  REALTIME: number;
  REALTIME_EVENTS: string;
  CREATED_AT?: string;
}

export const TYPE_MAP: Record<ColType, string> = {
  uuid: "VARCHAR2(36)",
  text: "VARCHAR2(4000)",
  longtext: "CLOB",
  number: "NUMBER(10)",
  decimal: "NUMBER(38,10)",
  boolean: "NUMBER(1)",
  json: "CLOB",
  timestamp: "TIMESTAMP",
  date: "DATE",
};

export const MAX_TABLES_PER_PROJECT = 60;

/* ------------------------------- PROJECTS --------------------------------- */

export function prefixFor(projectId: string): string {
  return `DHR${projectId.replace(/-/g, "").slice(0, 6).toUpperCase()}_`;
}

export interface ProjectRow {
  ID: string;
  NAME: string;
  DESCRIPTION: string | null;
  COLOR: string | null;
  AUTO_CREATE_TABLES: number;
  STATUS: string;
  OWNER_ID?: string | null;
  CREATED_AT?: string;
}

/** List projects. Platform admins see all; members only see what they own. */
export async function listProjects(userId?: string, isAdmin = false): Promise<ProjectRow[]> {
  if (isAdmin) {
    const r = await q(`SELECT * FROM DHARA_PROJECTS WHERE STATUS = 'active' ORDER BY CREATED_AT ASC`);
    return r.rows as unknown as ProjectRow[];
  }
  const r = await q(
    `SELECT * FROM DHARA_PROJECTS WHERE STATUS = 'active' AND OWNER_ID = :u ORDER BY CREATED_AT ASC`,
    { u: userId ?? "-" }
  );
  return r.rows as unknown as ProjectRow[];
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const r = await q(`SELECT * FROM DHARA_PROJECTS WHERE ID = :id`, { id });
  return (r.rows[0] as unknown as ProjectRow) ?? null;
}

export async function createProject(
  name: string,
  description?: string,
  color?: string,
  ownerId?: string
): Promise<ProjectRow> {
  if (!name || name.trim().length < 2 || name.length > 60) {
    throw new DharaError("Project name must be 2-60 characters", 400, "bad_project_name");
  }
  const row: ProjectRow = {
    ID: uuid(),
    NAME: name.trim(),
    DESCRIPTION: description?.slice(0, 380) ?? null,
    COLOR: color ?? "#14B8A6",
    AUTO_CREATE_TABLES: 1,
    STATUS: "active",
    OWNER_ID: ownerId ?? null,
  };
  await q(
    `INSERT INTO DHARA_PROJECTS (ID, NAME, DESCRIPTION, COLOR, OWNER_ID) VALUES (:id, :name, :descr, :color, :owner)`,
    { id: row.ID, name: row.NAME, descr: row.DESCRIPTION, color: row.COLOR, owner: row.OWNER_ID }
  );
  return row;
}

export async function updateProjectFlags(
  id: string,
  patch: { name?: string; description?: string; autoCreateTables?: boolean }
): Promise<ProjectRow | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  await q(
    `UPDATE DHARA_PROJECTS
     SET NAME = :name, DESCRIPTION = :descr, AUTO_CREATE_TABLES = :act
     WHERE ID = :id`,
    {
      id,
      name: patch.name?.trim() || existing.NAME,
      descr: patch.description !== undefined ? patch.description.slice(0, 380) : existing.DESCRIPTION,
      act: patch.autoCreateTables === undefined ? (existing.AUTO_CREATE_TABLES ? 1 : 0) : patch.autoCreateTables ? 1 : 0,
    }
  );
  return getProject(id);
}

export async function deleteProject(id: string): Promise<number> {
  const tables = await listTables(id);
  for (const t of tables) {
    try {
      await q(`DROP TABLE ${t.PHYSICAL} PURGE`);
    } catch {
      /* table may not exist physically */
    }
  }
  await q(`DELETE FROM DHARA_POLICIES WHERE PROJECT_ID = :id`, { id });
  await q(`DELETE FROM DHARA_WEBHOOKS WHERE PROJECT_ID = :id`, { id });
  await q(`DELETE FROM DHARA_API_KEYS WHERE PROJECT_ID = :id`, { id });
  await q(`DELETE FROM DHARA_TABLES WHERE PROJECT_ID = :id`, { id });
  const r = await q(`DELETE FROM DHARA_PROJECTS WHERE ID = :id`, { id });
  return r.rowsAffected;
}

/* -------------------------------- TABLES ---------------------------------- */

export function validateLogicalName(name: string): string {
  if (!name || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) {
    throw new DharaError(
      "Table name must start with a letter and contain only letters, numbers, underscore (max 40)",
      400,
      "bad_table_name"
    );
  }
  return name;
}

export function validateColumns(columns: ColumnDef[]): ColumnDef[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new DharaError("At least one column is required", 400, "no_columns");
  }
  if (columns.length > 60) throw new DharaError("Max 60 columns per table", 400, "too_many_columns");
  const seen = new Set<string>();
  let pks = 0;
  for (const c of columns) {
    c.name = validateLogicalName(c.name).toLowerCase();
    if (seen.has(c.name.toLowerCase())) {
      throw new DharaError(`Duplicate column: ${c.name}`, 400, "dup_column");
    }
    seen.add(c.name.toLowerCase());
    if (!Object.keys(TYPE_MAP).includes(c.type)) {
      throw new DharaError(`Unknown column type: ${c.type}`, 400, "bad_type");
    }
    if (c.pk) pks++;
  }
  if (pks > 1) throw new DharaError("Only one primary key column is supported", 400, "multi_pk");
  return columns;
}

function defaultLiteral(c: ColumnDef): string | null {
  const v = c.defaultValue;
  if (v === undefined || v === null || v === "") return null;
  switch (c.type) {
    case "number":
    case "decimal": {
      if (!/^-?\d+(\.\d+)?$/.test(String(v))) throw new DharaError(`Invalid number default: ${v}`, 400);
      return String(v);
    }
    case "boolean": {
      const n = String(v) === "true" ? 1 : 0;
      return String(n);
    }
    default:
      return `'${String(v).replace(/'/g, "''")}'`;
  }
}

export function columnDdl(c: ColumnDef): string {
  const name = assertIdent(c.name);
  const type = TYPE_MAP[c.type];
  let sql = `${name} ${type}`;
  const def = defaultLiteral(c);
  if (def !== null) sql += ` DEFAULT ${def}`;
  if (c.required || c.pk) sql += ` NOT NULL`;
  if (c.unique && !c.pk) sql += ` UNIQUE`;
  return sql;
}

export interface TableCreateResult {
  id: string;
  name: string;
  physical: string;
  columns: ColumnDef[];
}

export async function createTable(
  projectId: string,
  name: string,
  columnsIn: ColumnDef[],
  opts?: { skipDefaults?: boolean }
): Promise<TableCreateResult> {
  const logical = validateLogicalName(name);
  const existing = await getRegistry(projectId, logical);
  if (existing) throw new DharaError(`Table "${logical}" already exists`, 409, "table_exists");

  const countR = await q(`SELECT COUNT(*) AS N FROM DHARA_TABLES WHERE PROJECT_ID = :p`, {
    p: projectId,
  });
  if (Number(countR.rows[0]?.N ?? 0) >= MAX_TABLES_PER_PROJECT) {
    throw new DharaError(`Max ${MAX_TABLES_PER_PROJECT} tables per project`, 400, "table_limit");
  }

  let columns = validateColumns(JSON.parse(JSON.stringify(columnsIn)));
  if (!columns.some((c) => c.pk)) {
    columns = [
      { name: "id", type: "uuid", pk: true, required: true },
      ...columns.map((c) => ({ ...c, pk: false })),
    ];
  }
  if (!opts?.skipDefaults) {
    const names = columns.map((c) => c.name.toLowerCase());
    if (!names.includes("created_at")) {
      columns.push({ name: "created_at", type: "timestamp", required: true });
    }
    if (!names.includes("updated_at")) columns.push({ name: "updated_at", type: "timestamp" });
  }

  const physical = prefixFor(projectId) + assertIdent(logical);
  const colsSql = columns.map(columnDdl).join(", ");
  const pkCol = columns.find((c) => c.pk)!;
  const ddl = `CREATE TABLE ${physical} (${colsSql}, PRIMARY KEY (${assertIdent(pkCol.name)}))`;
  await q(ddl);

  const id = uuid();
  await q(
    `INSERT INTO DHARA_TABLES (ID, PROJECT_ID, NAME, PHYSICAL, COLUMNS) VALUES (:id, :p, :n, :ph, :c)`,
    { id, p: projectId, n: logical, ph: physical, c: JSON.stringify(columns) }
  );
  return { id, name: logical, physical, columns };
}

function parseRegistry(row: TableRegistryRow) {
  let cols: ColumnDef[] = [];
  try {
    cols = typeof row.COLUMNS === "string" ? JSON.parse(row.COLUMNS) : (row.COLUMNS as ColumnDef[]);
  } catch {
    cols = [];
  }
  return { ...row, columns: cols };
}

export async function listTables(projectId: string, withCounts = false) {
  const r = await q(
    `SELECT * FROM DHARA_TABLES WHERE PROJECT_ID = :p ORDER BY CREATED_AT ASC`,
    { p: projectId }
  );
  const tables = (r.rows as unknown as TableRegistryRow[]).map(parseRegistry);
  if (!withCounts) return tables.map(({ ...t }) => ({ ...t, rowCount: null as number | null }));
  const out: (TableRegistryRow & { rowCount: number | null })[] = [];
  for (const t of tables) {
    let rowCount: number | null = null;
    try {
      const c = await q(`SELECT COUNT(*) AS N FROM ${t.PHYSICAL}`);
      rowCount = Number(c.rows[0]?.N ?? 0);
    } catch {
      rowCount = null;
    }
    out.push({ ...t, rowCount });
  }
  return out;
}

export async function getRegistry(projectId: string, logicalName: string): Promise<ReturnType<typeof parseRegistry> | null> {
  const r = await q(
    `SELECT * FROM DHARA_TABLES WHERE PROJECT_ID = :p AND NAME = :n`,
    { p: projectId, n: logicalName }
  );
  const row = r.rows[0] as unknown as TableRegistryRow | undefined;
  return row ? parseRegistry(row) : null;
}

export async function getRegistryById(projectId: string, tableId: string) {
  const r = await q(`SELECT * FROM DHARA_TABLES WHERE PROJECT_ID = :p AND ID = :id`, {
    p: projectId,
    id: tableId,
  });
  const row = r.rows[0] as unknown as TableRegistryRow | undefined;
  return row ? parseRegistry(row) : null;
}

export async function dropTable(projectId: string, logicalName: string): Promise<void> {
  const reg = await getRegistry(projectId, logicalName);
  if (!reg) throw new DharaError(`Table "${logicalName}" not found`, 404, "table_not_found");
  await q(`DROP TABLE ${reg.PHYSICAL} PURGE`);
  await q(`DELETE FROM DHARA_TABLES WHERE ID = :id`, { id: reg.ID });
  await q(`DELETE FROM DHARA_POLICIES WHERE PROJECT_ID = :p AND TABLE_NAME = :n`, {
    p: projectId,
    n: logicalName,
  });
  await q(`DELETE FROM DHARA_WEBHOOKS WHERE PROJECT_ID = :p AND TABLE_NAME = :n`, {
    p: projectId,
    n: logicalName,
  });
}

export async function addColumn(
  projectId: string,
  logicalName: string,
  column: ColumnDef
): Promise<void> {
  const reg = await getRegistry(projectId, logicalName);
  if (!reg) throw new DharaError("Table not found", 404, "table_not_found");
  const exists = reg.columns.some((c) => c.name.toLowerCase() === column.name.toLowerCase());
  if (exists) throw new DharaError(`Column "${column.name}" already exists`, 409, "column_exists");
  await q(`ALTER TABLE ${reg.PHYSICAL} ADD (${columnDdl({ ...column, pk: false, unique: false })})`);
  const columns = [...reg.columns, { ...column, pk: false, unique: false }];
  await q(`UPDATE DHARA_TABLES SET COLUMNS = :c, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`, {
    c: JSON.stringify(columns),
    id: reg.ID,
  });
}

export async function dropColumn(
  projectId: string,
  logicalName: string,
  columnName: string
): Promise<void> {
  const reg = await getRegistry(projectId, logicalName);
  if (!reg) throw new DharaError("Table not found", 404, "table_not_found");
  const col = reg.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase());
  if (!col) throw new DharaError("Column not found", 404, "column_not_found");
  if (col.pk) throw new DharaError("Cannot drop the primary key column", 400, "pk_protected");
  await q(`ALTER TABLE ${reg.PHYSICAL} DROP (${assertIdent(col.name)})`);
  const columns = reg.columns.filter((c) => c.name.toLowerCase() !== columnName.toLowerCase());
  await q(`UPDATE DHARA_TABLES SET COLUMNS = :c, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`, {
    c: JSON.stringify(columns),
    id: reg.ID,
  });
}

export async function setRealtime(
  projectId: string,
  logicalName: string,
  enabled: boolean,
  events?: string
): Promise<void> {
  const reg = await getRegistry(projectId, logicalName);
  if (!reg) throw new DharaError("Table not found", 404, "table_not_found");
  await q(`UPDATE DHARA_TABLES SET REALTIME = :e, REALTIME_EVENTS = :ev, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`, {
    e: enabled ? 1 : 0,
    ev: events ?? reg.REALTIME_EVENTS ?? "insert,update,delete",
    id: reg.ID,
  });
}

/* --------------------------- AUTO TABLE FROM JSON -------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferType(value: unknown): ColType {
  if (value === null || value === undefined) return "text";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "number" : "decimal";
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) return "timestamp";
    return value.length > 3500 ? "longtext" : "text";
  }
  return "json";
}

/** Firebase-style: JSON payload in → table + columns auto-created. */
export async function autoTableFromJson(
  projectId: string,
  name: string,
  data: unknown
): Promise<{ created: boolean; table: TableCreateResult }> {
  const existing = await getRegistry(projectId, name);
  if (existing) {
    return {
      created: false,
      table: { id: existing.ID, name: existing.NAME, physical: existing.PHYSICAL, columns: existing.columns },
    };
  }
  const sample = Array.isArray(data) ? data.slice(0, 50) : [data];
  const keys = new Map<string, ColType>();
  for (const item of sample) {
    if (typeof item !== "object" || item === null) continue;
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (["id", "created_at", "updated_at"].includes(k.toLowerCase())) continue;
      if (!keys.has(k)) keys.set(k, inferType(v));
    }
  }
  const columns: ColumnDef[] = [...keys.entries()].map(([k, type]) => ({ name: k, type }));
  const table = await createTable(projectId, name, columns);
  return { created: true, table };
}

/* ------------------------------ ROW OPERATIONS ----------------------------- */

function colByName(cols: ColumnDef[], name: string): ColumnDef | undefined {
  return cols.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
}

function convertValue(c: ColumnDef, v: unknown): unknown {
  if (v === null) return null;
  switch (c.type) {
    case "boolean": {
      if (typeof v === "boolean") return v ? 1 : 0;
      if (v === 1 || v === "1" || v === "true") return 1;
      if (v === 0 || v === "0" || v === "false") return 0;
      throw new DharaError(`Invalid boolean value for ${c.name}: ${JSON.stringify(v)}`, 400);
    }
    case "json":
      return typeof v === "string" ? v : JSON.stringify(v);
    case "number":
    case "decimal": {
      const n = Number(v);
      if (Number.isNaN(n)) throw new DharaError(`Invalid number for ${c.name}: ${JSON.stringify(v)}`, 400);
      return n;
    }
    case "timestamp":
    case "date": {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new DharaError(`Invalid date for ${c.name}: ${JSON.stringify(v)}`, 400);
      return d;
    }
    default:
      return String(v);
  }
}

export interface Filter {
  col: string;
  op: string;
  val?: string;
}

export const FILTER_OPS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "contains", "not",
] as const;

export function parseFilters(params: URLSearchParams, cols: ColumnDef[]): Filter[] {
  const filters: Filter[] = [];
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "apikey"].includes(key)) continue;
    // PostgREST style: col=eq.val, col=neq.val, ... (documented API syntax)
    const pm = value.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|in|is|contains|not)\.([\s\S]*)$/);
    if (pm && colByName(cols, key)) {
      filters.push({ col: key, op: pm[1], val: pm[2] });
      continue;
    }
    // dotted style: col.eq=val (dashboard legacy)
    const m = key.match(/^(.+?)\.(.+)$/);
    if (!m) continue;
    const [, colRaw, opRaw] = m;
    if (!colByName(cols, colRaw)) continue;
    if (!(FILTER_OPS as readonly string[]).includes(opRaw)) continue;
    filters.push({ col: colRaw, op: opRaw, val: value });
  }
  return filters;
}

interface WhereResult {
  sql: string;
  binds: Record<string, unknown>;
}

export function buildWhere(cols: ColumnDef[], filters: Filter[], startIdx = 0): WhereResult {
  const binds: Record<string, unknown> = {};
  let i = startIdx;
  const parts: string[] = [];
  for (const f of filters) {
    const c = colByName(cols, f.col);
    if (!c) throw new DharaError(`Unknown column in filter: ${f.col}`, 400, "bad_filter_col");
    const phys = assertIdent(c.name);
    const bname = `:f${i++}`;
    switch (f.op) {
      case "eq": binds[`f${i - 1}`] = convertValue(c, f.val ?? ""); parts.push(`${phys} = ${bname}`); break;
      case "neq": case "not": binds[`f${i - 1}`] = convertValue(c, f.val ?? ""); parts.push(`${phys} <> ${bname}`); break;
      case "gt": binds[`f${i - 1}`] = convertValue(c, f.val ?? ""); parts.push(`${phys} > ${bname}`); break;
      case "gte": binds[`f${i - 1}`] = convertValue(c, f.val ?? ""); parts.push(`${phys} >= ${bname}`); break;
      case "lt": binds[`f${i - 1}`] = convertValue(c, f.val ?? ""); parts.push(`${phys} < ${bname}`); break;
      case "lte": binds[`f${i - 1}`] = convertValue(c, f.val ?? ""); parts.push(`${phys} <= ${bname}`); break;
      case "like":
      case "ilike":
        binds[`f${i - 1}`] = `%${String(f.val ?? "")}%`;
        parts.push(`UPPER(${phys}) LIKE UPPER(${bname})`);
        break;
      case "contains": {
        const v = String(f.val ?? "");
        binds[`f${i - 1}`] = c.type === "json" ? `%"${v}"%` : `%${v}%`;
        parts.push(`UPPER(${phys}) LIKE UPPER(${bname})`);
        break;
      }
      case "in": {
        const vals = String(f.val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (vals.length === 0) { parts.push(`1 = 0`); break; }
        const names = vals.map((v) => {
          const n = `f${i++}`;
          binds[n] = convertValue(c, v);
          return `:${n}`;
        });
        parts.push(`${phys} IN (${names.join(", ")})`);
        break;
      }
      case "is": {
        const v = String(f.val ?? "null").toLowerCase();
        if (v === "null") parts.push(`${phys} IS NULL`);
        else if (v === "not null" || v === "notnull") parts.push(`${phys} IS NOT NULL`);
        else if (v === "true") { binds[`f${i - 1}`] = 1; parts.push(`${phys} = ${bname}`); }
        else if (v === "false") { binds[`f${i - 1}`] = 0; parts.push(`${phys} = ${bname}`); }
        else throw new DharaError(`Unsupported is.${v}`, 400);
        break;
      }
      default:
        throw new DharaError(`Unknown filter operator: ${f.op}`, 400, "bad_op");
    }
  }
  return { sql: parts.length ? `(${parts.join(" AND ")})` : "", binds };
}

/* --------------------------------- RLS ENGINE ------------------------------ */

export type RlsRole = "anon" | "authenticated" | "service";

export interface RlsCtx {
  role: RlsRole;
  userId?: string;
}

interface PolicyRow {
  ID: string;
  TABLE_NAME: string;
  NAME: string;
  ACTION: string;
  ROLES: string;
  USING_EXPR: string | null;
  WITH_CHECK: string | null;
  ENABLED: number;
}

const policyCache = new Map<string, { at: number; rows: PolicyRow[] }>();

export async function getPolicies(projectId: string, tableName: string): Promise<PolicyRow[]> {
  const key = `${projectId}:${tableName}`;
  const cached = policyCache.get(key);
  if (cached && Date.now() - cached.at < 10_000) return cached.rows;
  const r = await q(
    `SELECT ID, TABLE_NAME, NAME, ACTION, ROLES, USING_EXPR, WITH_CHECK, ENABLED
     FROM DHARA_POLICIES WHERE PROJECT_ID = :p AND TABLE_NAME = :t AND ENABLED = 1`,
    { p: projectId, t: tableName.toLowerCase() }
  );
  const rows = r.rows as unknown as PolicyRow[];
  policyCache.set(key, { at: Date.now(), rows });
  return rows;
}

export function clearPolicyCache(projectId?: string) {
  if (!projectId) return policyCache.clear();
  for (const k of policyCache.keys()) if (k.startsWith(`${projectId}:`)) policyCache.delete(k);
}

/** Tokenizer + recursive-descent compiler for policy expressions. */
export function compileRlsExpr(
  expr: string,
  cols: ColumnDef[],
  ctx: RlsCtx,
  bindPrefix = "rls"
): WhereResult {
  const src = expr.trim();
  if (!src) throw new DharaError("Empty policy expression", 400, "rls_empty");
  if (src.length > 600) throw new DharaError("Policy expression too long (max 600 chars)", 400, "rls_long");

  const binds: Record<string, unknown> = {};
  let bi = 0;
  let pos = 0;

  const bind = (v: unknown): string => {
    const n = `${bindPrefix}${bi++}`;
    binds[n] = v;
    return `:${n}`;
  };

  function ws() {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function tryWord(word: string): boolean {
    const save = pos;
    ws();
    const re = new RegExp(`^${word}\\b`, "i");
    const m = src.slice(pos).match(re);
    if (m) {
      pos += m[0].length;
      return true;
    }
    pos = save;
    return false;
  }

  function parseOr(): string {
    let left = parseAnd();
     
    while (true) {
      const save = pos;
      if (tryWord("or")) {
        const right = parseAnd();
        left = `(${left} OR ${right})`;
      } else {
        pos = save;
        break;
      }
    }
    return left;
  }

  function parseAnd(): string {
    let left = parseAtom();
     
    while (true) {
      const save = pos;
      if (tryWord("and")) {
        const right = parseAtom();
        left = `(${left} AND ${right})`;
      } else {
        pos = save;
        break;
      }
    }
    return left;
  }

  function parseAtom(): string {
    ws();
    if (src[pos] === "(") {
      pos++;
      const inner = parseOr();
      ws();
      if (src[pos] !== ")") throw new DharaError("Expected ) in policy expression", 400, "rls_parse");
      pos++;
      return `(${inner})`;
    }
    // bare boolean atoms (e.g. using: "true")
    if (tryWord("true")) return "1 = 1";
    if (tryWord("false")) return "1 = 0";
    return parseComparison();
  }

  function parseOperand(): string {
    ws();
    const rest = src.slice(pos);
    // auth.uid()
    const uidMatch = rest.match(/^auth\.uid\(\)/i);
    if (uidMatch) {
      pos += uidMatch[0].length;
      if (ctx.role !== "authenticated" || !ctx.userId) return `1 = 0`;
      return bind(ctx.userId);
    }
    // string literal
    if (src[pos] === "'") {
      const end = src.indexOf("'", pos + 1);
      if (end === -1) throw new DharaError("Unterminated string in policy expression", 400, "rls_parse");
      const s = src.slice(pos + 1, end);
      pos = end + 1;
      return bind(s);
    }
    // number
    const numMatch = rest.match(/^-?\d+(\.\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      return bind(Number(numMatch[0]));
    }
    // true / false / null
    if (tryWord("true")) return "1 = 1";
    if (tryWord("false")) return "1 = 0";
    if (tryWord("null")) return bind(null);
    // identifier
    const idMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (idMatch) {
      const col = colByName(cols, idMatch[0]);
      if (!col) {
        throw new DharaError(`Unknown column "${idMatch[0]}" in policy expression`, 400, "rls_bad_column");
      }
      pos += idMatch[0].length;
      return assertIdent(col.name);
    }
    throw new DharaError(`Unexpected token at: "${rest.slice(0, 20)}"`, 400, "rls_parse");
  }

  function parseComparison(): string {
    const left = parseOperand();
    ws();
    if (tryWord("is")) {
      const not = tryWord("not");
      if (!tryWord("null")) throw new DharaError("Expected NULL after IS", 400, "rls_parse");
      return `${left} IS ${not ? "NOT " : ""}NULL`;
    }
    if (tryWord("in")) {
      ws();
      if (src[pos] !== "(") throw new DharaError("Expected ( after IN", 400, "rls_parse");
      pos++;
      const items: string[] = [];
       
      while (true) {
        items.push(parseOperand());
        ws();
        if (src[pos] === ",") { pos++; continue; }
        break;
      }
      if (src[pos] !== ")") throw new DharaError("Expected ) after IN list", 400, "rls_parse");
      pos++;
      return `${left} IN (${items.join(", ")})`;
    }
    const opMatch = src.slice(pos).match(/^(=|!=|<>|>=|<=|>|<|like|ilike)\b/i);
    if (!opMatch) throw new DharaError(`Expected operator near "${src.slice(pos, pos + 16)}"`, 400, "rls_parse");
    pos += opMatch[0].length;
    const op = opMatch[0].toLowerCase();
    const right = parseOperand();
    switch (op) {
      case "=": return `${left} = ${right}`;
      case "!=": case "<>": return `${left} <> ${right}`;
      case ">": return `${left} > ${right}`;
      case ">=": return `${left} >= ${right}`;
      case "<": return `${left} < ${right}`;
      case "<=": return `${left} <= ${right}`;
      case "like": case "ilike": return `UPPER(${left}) LIKE UPPER(${right})`;
      default: throw new DharaError("Unknown operator", 400, "rls_parse");
    }
  }

  const sql = parseOr();
  ws();
  if (pos < src.length) {
    throw new DharaError(`Unexpected trailing tokens: "${src.slice(pos, pos + 20)}"`, 400, "rls_parse");
  }
  return { sql, binds };
}

export interface RlsResult {
  bypass: boolean;
  whereSql: string;
  binds: Record<string, unknown>;
  denied: boolean;
}

/**
 * Combine filters + RLS policies into one WHERE clause.
 * No matching policy → denied (secure by default, Supabase-style).
 */
export function applyRls(
  policies: PolicyRow[],
  action: "select" | "insert" | "update" | "delete",
  ctx: RlsCtx,
  cols: ColumnDef[],
  filters?: WhereResult
): RlsResult {
  if (ctx.role === "service") {
    return {
      bypass: true,
      whereSql: filters?.sql ?? "",
      binds: { ...(filters?.binds ?? {}) },
      denied: false,
    };
  }
  const matching = policies.filter(
    (p) => (p.ACTION === action || p.ACTION === "all") && String(p.ROLES ?? "").split(",").map((s) => s.trim()).includes(ctx.role)
  );
  if (matching.length === 0) {
    return { bypass: false, whereSql: "1 = 0", binds: {}, denied: true };
  }
  const usingParts: string[] = [];
  const usingBinds: Record<string, unknown> = {};
  let off = 0;
  for (const p of matching) {
    const compiled = compileRlsExpr(p.USING_EXPR ?? "false", cols, ctx, `rls${off++}_`);
    Object.assign(usingBinds, compiled.binds);
    usingParts.push(compiled.sql);
  }
  const orCombined = `(${usingParts.join(" OR ")})`;
  const allBinds = { ...usingBinds, ...(filters?.binds ?? {}) };
  const filterSql = filters?.sql ?? "";
  const whereSql = [orCombined, filterSql].filter(Boolean).join(" AND ");
  return { bypass: false, whereSql: whereSql || "1 = 0", binds: allBinds, denied: false };
}

/* ------------------------------ SELECT / CRUD ------------------------------ */

export interface SelectOptions {
  select?: string[];
  filters?: Filter[];
  order?: { col: string; dir: "asc" | "desc" } | null;
  limit?: number;
  offset?: number;
}

export function rlsCtxFor(role: RlsRole, userId?: string): RlsCtx {
  return { role, userId };
}

export async function selectRows(
  reg: ReturnType<typeof parseRegistry>,
  opts: SelectOptions,
  rls: RlsResult
) {
  const cols = reg.columns;
  let selectList = "*";
  if (opts.select?.length) {
    const valid = opts.select
      .map((s) => colByName(cols, s))
      .filter(Boolean)
      .map((c) => assertIdent(c!.name));
    if (valid.length) selectList = valid.join(", ");
  }
  const binds: Record<string, unknown> = { ...rls.binds };
  let sql = `SELECT ${selectList} FROM ${reg.PHYSICAL}`;
  if (rls.whereSql) sql += ` WHERE ${rls.whereSql}`;
  if (opts.order?.col) {
    const c = colByName(cols, opts.order.col);
    if (c) sql += ` ORDER BY ${assertIdent(c.name)} ${opts.order.dir === "desc" ? "DESC" : "ASC"}`;
  }
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 1000);
  const offset = Math.max(0, opts.offset ?? 0);
  sql += ` OFFSET :dh_offset ROWS FETCH NEXT :dh_limit ROWS ONLY`;
  binds.dh_offset = offset;
  binds.dh_limit = limit;

  const r = await q(sql, binds);
  const rows = r.rows.map(decodeRows(cols));

  // total count (same predicates)
  let total: number | null = null;
  try {
    let countSql = `SELECT COUNT(*) AS N FROM ${reg.PHYSICAL}`;
    const countBinds: Record<string, unknown> = {};
    if (rls.whereSql) {
      countSql += ` WHERE ${rls.whereSql}`;
      for (const [k, v] of Object.entries(rls.binds)) {
        if (k !== "dh_offset" && k !== "dh_limit") countBinds[k] = v;
      }
    }
    const cr = await q(countSql, countBinds);
    total = Number(cr.rows[0]?.N ?? 0);
  } catch {
    total = null;
  }
  return { rows, total };
}

function decodeRows(cols: ColumnDef[]) {
  return (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      const key = Object.keys(row).find((k) => k.toLowerCase() === c.name.toLowerCase());
      if (key === undefined) continue;
      let v = row[key];
      if ((c.type === "boolean") && (v === 0 || v === 1 || v === "0" || v === "1")) v = v === 1 || v === "1";
      if ((c.type === "json") && typeof v === "string") {
        try {
          v = JSON.parse(v);
        } catch {
          /* keep string */
        }
      }
      out[c.name] = v;
    }
    return out;
  };
}

function rowToBinds(cols: ColumnDef[], data: Record<string, unknown>) {
  const binds: Record<string, unknown> = {};
  const physCols: string[] = [];
  for (const c of cols) {
    if (!(c.name in data)) continue;
    if (c.name.toLowerCase() === "created_at" || c.name.toLowerCase() === "updated_at") continue;
    binds[c.name.toLowerCase()] = convertValue(c, data[c.name]);
    physCols.push(assertIdent(c.name));
  }
  // auto columns
  for (const c of cols) {
    const n = c.name.toLowerCase();
    if (n === "created_at" && physCols.every((x) => x !== "CREATED_AT")) {
      binds.created_at = new Date();
      physCols.push("CREATED_AT");
    }
    if (n === "updated_at" && physCols.every((x) => x !== "UPDATED_AT")) {
      binds.updated_at = new Date();
      physCols.push("UPDATED_AT");
    }
  }
  // auto uuid pk
  const pk = cols.find((c) => c.pk);
  if (pk && pk.type === "uuid" && !(pk.name in data)) {
    binds[pk.name.toLowerCase()] = uuid();
    physCols.push(assertIdent(pk.name));
  }
  return { binds, physCols };
}

export async function insertRows(
  reg: ReturnType<typeof parseRegistry>,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new DharaError("Body must be an object or a non-empty array of objects", 400, "bad_body");
  }
  if (rows.length > 100) throw new DharaError("Max 100 rows per insert call", 400, "batch_limit");
  const cols = reg.columns;
  const insertedIds: unknown[] = [];
  const pk = cols.find((c) => c.pk);
  for (const data of rows) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new DharaError("Each row must be an object", 400, "bad_row");
    }
    const { binds, physCols } = rowToBinds(cols, data);
    if (physCols.length === 0) throw new DharaError("Row has no valid columns", 400, "empty_row");
    const sql = `INSERT INTO ${reg.PHYSICAL} (${physCols.join(", ")}) VALUES (${physCols
      .map((c) => `:${c.toLowerCase()}`)
      .join(", ")})`;
    await q(sql, binds);
    if (pk) insertedIds.push(binds[pk.name.toLowerCase()] ?? convertValue(pk, data[pk.name]));
  }
  // return inserted rows
  if (pk && insertedIds.length) {
    const colName = assertIdent(pk.name);
    const pb: Record<string, unknown> = {};
    const inList = insertedIds
      .map((v, i) => {
        pb[`id${i}`] = v;
        return `:id${i}`;
      })
      .join(", ");
    const r2 = await q(
      `SELECT * FROM ${reg.PHYSICAL} WHERE ${colName} IN (${inList})`,
      pb
    );
    return r2.rows.map(decodeRows(cols));
  }
  return [];
}

export async function updateRows(
  reg: ReturnType<typeof parseRegistry>,
  updates: Record<string, unknown>,
  rls: RlsResult
): Promise<{ count: number; rows: Record<string, unknown>[]; oldRows: Record<string, unknown>[] }> {
  const cols = reg.columns;
  const pk = cols.find((c) => c.pk);
  const sets: string[] = [];
  const binds: Record<string, unknown> = { ...rls.binds };
  for (const [k, v] of Object.entries(updates)) {
    if (pk && k.toLowerCase() === pk.name.toLowerCase()) continue;
    const c = colByName(cols, k);
    if (!c) throw new DharaError(`Unknown column in update: ${k}`, 400, "bad_update_col");
    sets.push(`${assertIdent(c.name)} = :set_${c.name.toLowerCase()}`);
    binds[`set_${c.name.toLowerCase()}`] = convertValue(c, v);
  }
  if (cols.some((c) => c.name.toLowerCase() === "updated_at")) {
    sets.push(`UPDATED_AT = :ikl_now`);
    binds.ikl_now = new Date();
  }
  if (sets.length === 0) throw new DharaError("No valid columns to update", 400, "empty_update");

  // capture old rows for event payload
  const where = rls.whereSql ? ` WHERE ${rls.whereSql}` : "";
  const oldSel = await q(`SELECT * FROM ${reg.PHYSICAL}${where}`, binds);
  const oldRows = oldSel.rows.map(decodeRows(cols));

  let sql = `UPDATE ${reg.PHYSICAL} SET ${sets.join(", ")}`;
  if (rls.whereSql) sql += ` WHERE ${rls.whereSql}`;
  const r = await q(sql, binds);
  const newRows = rls.whereSql
    ? (await q(`SELECT * FROM ${reg.PHYSICAL} WHERE ${rls.whereSql}`, rls.binds)).rows.map(decodeRows(cols))
    : [];
  return { count: r.rowsAffected, rows: newRows, oldRows };
}

export async function deleteRows(
  reg: ReturnType<typeof parseRegistry>,
  filters: Filter[],
  rls: RlsResult
): Promise<{ count: number; rows: Record<string, unknown>[] }> {
  const cols = reg.columns;
  const where = rls.whereSql ? ` WHERE ${rls.whereSql}` : "";
  const binds = { ...rls.binds };
  const sel = await q(`SELECT * FROM ${reg.PHYSICAL}${where}`, binds);
  const oldRows = sel.rows.map(decodeRows(cols));
  if (oldRows.length === 0) return { count: 0, rows: [] };
  const r = await q(`DELETE FROM ${reg.PHYSICAL}${where}`, binds);
  return { count: r.rowsAffected, rows: oldRows };
}

/* ------------------------------ SCHEMA SYNC -------------------------------- */

/** Rebuild the column registry from the live Oracle catalog (SQL-created tables). */
export async function syncSchema(projectId: string, logicalName: string) {
  const reg = await getRegistry(projectId, logicalName);
  if (!reg) throw new DharaError("Table not found in registry. Create it in the Table Editor first.", 404, "table_not_found");
  const colsR = await q(
    `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE
     FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :t ORDER BY COLUMN_ID`,
    { t: reg.PHYSICAL }
  );
  const pkR = await q(
    `SELECT CC.COLUMN_NAME
     FROM USER_CONSTRAINTS C
     JOIN USER_CONS_COLUMNS CC ON C.CONSTRAINT_NAME = CC.CONSTRAINT_NAME AND C.OWNER = CC.OWNER
     WHERE C.TABLE_NAME = :t AND C.CONSTRAINT_TYPE = 'P'
     ORDER BY CC.POSITION`,
    { t: reg.PHYSICAL }
  );
  const pkCols = new Set(pkR.rows.map((r2) => String(r2.COLUMN_NAME).toLowerCase()));
  const typeMap: Record<string, ColType> = {
    VARCHAR2: "text",
    CLOB: "longtext",
    NUMBER: "number",
    TIMESTAMP: "timestamp",
    DATE: "date",
  };
  const columns: ColumnDef[] = colsR.rows.map((r2) => {
    let type = typeMap[String(r2.DATA_TYPE)] ?? "text";
    if (String(r2.DATA_TYPE) === "NUMBER") {
      const scale = r2.DATA_SCALE === null ? 0 : Number(r2.DATA_SCALE);
      if (scale > 0) type = "decimal";
    }
    if (String(r2.DATA_TYPE) === "VARCHAR2" && Number(r2.DATA_LENGTH) === 36 && pkCols.has(String(r2.COLUMN_NAME).toLowerCase())) {
      type = "uuid";
    }
    return {
      name: String(r2.COLUMN_NAME).toLowerCase(),
      type,
      pk: pkCols.has(String(r2.COLUMN_NAME).toLowerCase()),
      required: String(r2.NULLABLE) === "N",
    } as ColumnDef;
  });
  await q(`UPDATE DHARA_TABLES SET COLUMNS = :c, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`, {
    c: JSON.stringify(columns),
    id: reg.ID,
  });
  return columns;
}
