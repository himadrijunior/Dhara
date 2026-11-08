import { describe, expect, it } from "vitest";
import { buildWhere, parseFilters, type ColumnDef, type Filter } from "@/lib/server/dbapi";
import { DharaError } from "@/lib/server/oracle";

/**
 * PostgREST-style filter parser + WHERE builder — pure functions (URLSearchParams
 * in, SQL fragment + bind map out). All values must be parameterized, never
 * interpolated into the SQL string.
 */

const COLS: ColumnDef[] = [
  { name: "name", type: "text" },
  { name: "status", type: "text" },
  { name: "age", type: "number" },
  { name: "active", type: "boolean" },
];

function one(filter: Filter) {
  return buildWhere(COLS, [filter]);
}

describe("parseFilters — syntax", () => {
  it("parses the PostgREST style `col=op.val`", () => {
    const f = parseFilters(new URLSearchParams("name=eq.Alice"), COLS);
    expect(f).toEqual([{ col: "name", op: "eq", val: "Alice" }]);
  });

  it("parses the dotted legacy style `col.op=val`", () => {
    const f = parseFilters(new URLSearchParams("name.eq=Alice"), COLS);
    expect(f).toEqual([{ col: "name", op: "eq", val: "Alice" }]);
  });

  it("both syntaxes produce identical WHERE SQL", () => {
    const a = buildWhere(COLS, parseFilters(new URLSearchParams("name=eq.Alice"), COLS));
    const b = buildWhere(COLS, parseFilters(new URLSearchParams("name.eq=Alice"), COLS));
    expect(a).toEqual(b);
    expect(a.sql).toBe("(NAME = :f0)");
    expect(a.binds).toEqual({ f0: "Alice" });
  });

  it("ignores reserved params (select, order, limit, offset, apikey)", () => {
    const f = parseFilters(
      new URLSearchParams("select=*&order=name.asc&limit=10&offset=5&apikey=x"),
      COLS
    );
    expect(f).toEqual([]);
  });

  it("silently drops unknown columns instead of building SQL from them", () => {
    expect(parseFilters(new URLSearchParams("nope=eq.x"), COLS)).toEqual([]);
    expect(parseFilters(new URLSearchParams("nope.eq=x"), COLS)).toEqual([]);
  });

  it("ignores unknown operators in the dotted style", () => {
    expect(parseFilters(new URLSearchParams("name.regex=.*"), COLS)).toEqual([]);
  });

  it("keeps values that contain dots intact after the first op separator", () => {
    const f = parseFilters(new URLSearchParams("name=eq.Al.ice"), COLS);
    expect(f).toEqual([{ col: "name", op: "eq", val: "Al.ice" }]);
  });
});

describe("buildWhere — operators", () => {
  it("in-list: one bind per element, values parameterized", () => {
    const r = one({ col: "status", op: "in", val: "active,archived" });
    expect(r.sql).toBe("(STATUS IN (:f1, :f2))");
    expect(r.binds).toEqual({ f1: "active", f2: "archived" });
  });

  it("in-list with an empty value list short-circuits to a never-true clause", () => {
    const r = one({ col: "status", op: "in", val: "," });
    expect(r.sql).toBe("(1 = 0)");
    expect(r.binds).toEqual({});
  });

  it("like and ilike wrap the value in %…% and stay parameterized", () => {
    const like = one({ col: "name", op: "like", val: "li" });
    expect(like.sql).toBe("(UPPER(NAME) LIKE UPPER(:f0))");
    expect(like.binds).toEqual({ f0: "%li%" });
    const ilike = one({ col: "name", op: "ilike", val: "LI" });
    expect(ilike.sql).toBe("(UPPER(NAME) LIKE UPPER(:f0))");
    expect(ilike.binds).toEqual({ f0: "%LI%" });
  });

  it("is.null / is.not.null produce IS [NOT] NULL without binds", () => {
    expect(one({ col: "name", op: "is", val: "null" })).toEqual({
      sql: "(NAME IS NULL)",
      binds: {},
    });
    expect(one({ col: "name", op: "is", val: "not null" })).toEqual({
      sql: "(NAME IS NOT NULL)",
      binds: {},
    });
  });

  it("is.true / is.false bind numeric booleans", () => {
    expect(one({ col: "active", op: "is", val: "true" }).binds).toEqual({ f0: 1 });
    expect(one({ col: "active", op: "is", val: "false" }).binds).toEqual({ f0: 0 });
  });

  it("rejects unsupported is.* values", () => {
    expect(() => one({ col: "name", op: "is", val: "maybe" })).toThrowError(DharaError);
  });

  it("converts values to the column type (number)", () => {
    const r = one({ col: "age", op: "gte", val: "18" });
    expect(r.sql).toBe("(AGE >= :f0)");
    expect(r.binds).toEqual({ f0: 18 });
  });

  it("rejects non-numeric values for number columns", () => {
    expect(() => one({ col: "age", op: "eq", val: "abc" })).toThrowError(DharaError);
  });

  it("AND-joins multiple filters and honors startIdx for bind numbering", () => {
    const r = buildWhere(
      COLS,
      [
        { col: "name", op: "eq", val: "Alice" },
        { col: "age", op: "gte", val: "18" },
      ],
      5
    );
    expect(r.sql).toBe("(NAME = :f5 AND AGE >= :f6)");
    expect(r.binds).toEqual({ f5: "Alice", f6: 18 });
  });

  it("returns an empty WHERE for an empty filter list", () => {
    expect(buildWhere(COLS, [])).toEqual({ sql: "", binds: {} });
  });

  it("throws on unknown columns passed directly (defense in depth)", () => {
    try {
      one({ col: "DROP TABLE x; --", op: "eq", val: "1" });
      expect.unreachable("buildWhere should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DharaError);
      expect((e as DharaError).code).toBe("bad_filter_col");
    }
  });
});

describe("buildWhere — SQL injection stays parameterized", () => {
  it("classic boolean bypass in an eq value ends up in a bind, not the SQL", () => {
    const payload = "' OR '1'='1";
    const r = one({ col: "name", op: "eq", val: payload });
    expect(r.sql).toBe("(NAME = :f0)");
    expect(r.sql).not.toContain("OR");
    expect(r.sql).not.toContain("'1'");
    expect(r.binds).toEqual({ f0: payload });
  });

  it("injection via in-list elements stays bound per element", () => {
    const r = one({ col: "status", op: "in", val: "a,b) OR (1=1" });
    expect(r.sql).toBe("(STATUS IN (:f1, :f2))");
    expect(r.binds).toEqual({ f1: "a", f2: "b) OR (1=1" });
  });

  it("LIKE metacharacters / payload bound, never interpolated", () => {
    const payload = "%' OR 1=1 --";
    const r = one({ col: "name", op: "like", val: payload });
    expect(r.sql).toBe("(UPPER(NAME) LIKE UPPER(:f0))");
    expect(r.binds).toEqual({ f0: `%${payload}%` });
  });

  it("UNION-based payload cannot reach the SQL string", () => {
    const payload = "x' UNION SELECT password FROM users--";
    const r = one({ col: "name", op: "eq", val: payload });
    expect(r.sql).not.toContain("UNION");
    expect(r.sql).not.toContain("SELECT");
    expect(Object.values(r.binds)).toContain(payload);
  });
});
