import { describe, expect, it } from "vitest";
import { applyRls, compileRlsExpr, rlsCtxFor, type ColumnDef } from "@/lib/server/dbapi";
import { DharaError } from "@/lib/server/oracle";

/**
 * RLS compiler — pure functions only (no DB: policies are passed in directly,
 * exactly as getPolicies() would return them).
 *
 * Parser note (actual behavior, probed): symbol operators (`=`, `>`, …) must be
 * immediately followed by a word character — `owner_id=auth.uid()` compiles,
 * `owner_id = auth.uid()` fails closed with a parse error. Word operators
 * (`like`, `ilike`) accept spaces. Tests below use the working syntax.
 */

const COLS: ColumnDef[] = [
  { name: "id", type: "uuid" },
  { name: "owner_id", type: "uuid" },
  { name: "title", type: "text" },
];

type Policy = Parameters<typeof applyRls>[0][number];

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    ID: "pol-1",
    TABLE_NAME: "posts",
    NAME: "default",
    ACTION: "all",
    ROLES: "anon,authenticated",
    USING_EXPR: "true",
    WITH_CHECK: null,
    ENABLED: 1,
    ...overrides,
  };
}

describe("applyRls — deny by default", () => {
  it("denies when there is no policy at all", () => {
    const r = applyRls([], "select", rlsCtxFor("anon"), COLS);
    expect(r.denied).toBe(true);
    expect(r.bypass).toBe(false);
    expect(r.whereSql).toBe("1 = 0");
    expect(r.binds).toEqual({});
  });

  it("denies when no policy matches the action", () => {
    const r = applyRls([policy({ ACTION: "insert" })], "select", rlsCtxFor("anon"), COLS);
    expect(r.denied).toBe(true);
    expect(r.whereSql).toBe("1 = 0");
  });

  it("denies when no policy matches the role", () => {
    const r = applyRls(
      [policy({ ACTION: "select", ROLES: "authenticated" })],
      "select",
      rlsCtxFor("anon"),
      COLS
    );
    expect(r.denied).toBe(true);
    expect(r.whereSql).toBe("1 = 0");
  });

  it("compiles a policy with null USING_EXPR to a never-true clause (fail closed)", () => {
    const r = applyRls([policy({ USING_EXPR: null })], "select", rlsCtxFor("anon"), COLS);
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("(1 = 0)");
    expect(r.binds).toEqual({});
  });
});

describe("applyRls — allow rules", () => {
  it("allows anon via an `all` policy with a true expr", () => {
    const r = applyRls([policy()], "select", rlsCtxFor("anon"), COLS);
    expect(r.denied).toBe(false);
    expect(r.bypass).toBe(false);
    expect(r.whereSql).toBe("(1 = 1)");
    expect(r.binds).toEqual({});
  });

  it("allows with a `select`-only policy for the matching role", () => {
    const r = applyRls(
      [policy({ ACTION: "select", ROLES: "authenticated", USING_EXPR: "true" })],
      "select",
      rlsCtxFor("authenticated", "u-1"),
      COLS
    );
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("(1 = 1)");
  });

  it("substitutes auth.uid() with a bound parameter for authenticated users", () => {
    const r = applyRls(
      [policy({ USING_EXPR: "owner_id=auth.uid()" })],
      "select",
      rlsCtxFor("authenticated", "11111111-1111-1111-1111-111111111111"),
      COLS
    );
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("(OWNER_ID = :rls0_0)");
    expect(r.binds).toEqual({ rls0_0: "11111111-1111-1111-1111-111111111111" });
  });

  it("substitutes auth.uid() when it appears as the right-hand operand too", () => {
    const r = compileRlsExpr("auth.uid()=owner_id", COLS, rlsCtxFor("authenticated", "u-9"), "x_");
    expect(r.sql).toBe(":x_0 = OWNER_ID");
    expect(r.binds).toEqual({ x_0: "u-9" });
  });

  it("auth.uid() for anon compiles to a never-true clause with no binds", () => {
    const r = applyRls(
      [policy({ ROLES: "anon", USING_EXPR: "owner_id=auth.uid()" })],
      "select",
      rlsCtxFor("anon"),
      COLS
    );
    expect(r.whereSql).toContain("1 = 0");
    expect(r.binds).toEqual({});
  });

  it("OR-combines multiple matching policies with isolated bind prefixes", () => {
    const r = applyRls(
      [
        policy({ NAME: "public", USING_EXPR: "title like 'public'" }),
        policy({ NAME: "own", USING_EXPR: "owner_id=auth.uid()" }),
      ],
      "select",
      rlsCtxFor("authenticated", "u-42"),
      COLS
    );
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("(UPPER(TITLE) LIKE UPPER(:rls0_0) OR OWNER_ID = :rls1_0)");
    expect(r.binds).toEqual({ rls0_0: "public", rls1_0: "u-42" });
  });

  it("AND-combines user filters on top of the policy clause", () => {
    const r = applyRls(
      [policy({ USING_EXPR: "owner_id=auth.uid()" })],
      "select",
      rlsCtxFor("authenticated", "u-42"),
      COLS,
      { sql: "TITLE = :f0", binds: { f0: "hello" } }
    );
    expect(r.whereSql).toBe("(OWNER_ID = :rls0_0) AND TITLE = :f0");
    expect(r.binds).toEqual({ rls0_0: "u-42", f0: "hello" });
  });

  it("applies the same USING_EXPR for non-select actions (WITH_CHECK is not compiled here)", () => {
    const r = applyRls(
      [policy({ ACTION: "delete", ROLES: "authenticated", USING_EXPR: "owner_id=auth.uid()" })],
      "delete",
      rlsCtxFor("authenticated", "u-7"),
      COLS
    );
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("(OWNER_ID = :rls0_0)");
    expect(r.binds).toEqual({ rls0_0: "u-7" });
  });
});

describe("applyRls — service role bypass", () => {
  it("bypasses all policies and keeps only the user filters", () => {
    const r = applyRls(
      [policy({ USING_EXPR: "false" })],
      "select",
      rlsCtxFor("service"),
      COLS,
      { sql: "TITLE = :f0", binds: { f0: "keep-me" } }
    );
    expect(r.bypass).toBe(true);
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("TITLE = :f0");
    expect(r.binds).toEqual({ f0: "keep-me" });
  });

  it("bypasses even with zero policies and no filters (empty WHERE, not denied)", () => {
    const r = applyRls([], "select", rlsCtxFor("service"), COLS);
    expect(r.bypass).toBe(true);
    expect(r.denied).toBe(false);
    expect(r.whereSql).toBe("");
    expect(r.binds).toEqual({});
  });
});

describe("compileRlsExpr — expression hardening", () => {
  it("binds string literals and numbers instead of interpolating them", () => {
    const r = compileRlsExpr("title like 'x' OR title like 'y'", COLS, rlsCtxFor("anon"), "p_");
    expect(r.sql).toBe("(UPPER(TITLE) LIKE UPPER(:p_0) OR UPPER(TITLE) LIKE UPPER(:p_1))");
    expect(r.binds).toEqual({ p_0: "x", p_1: "y" });
    const n = compileRlsExpr("owner_id=123", COLS, rlsCtxFor("anon"), "p_");
    expect(n.sql).toBe("OWNER_ID = :p_0");
    expect(n.binds).toEqual({ p_0: 123 });
  });

  it("rejects unknown columns in policy expressions", () => {
    let err: unknown = null;
    try {
      compileRlsExpr("not_a_column=1", COLS, rlsCtxFor("anon"), "p_");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DharaError);
    expect((err as DharaError).code).toBe("rls_bad_column");
  });

  it("rejects empty and oversized expressions (fail closed)", () => {
    expect(() => compileRlsExpr("   ", COLS, rlsCtxFor("anon"))).toThrowError(DharaError);
    expect(() => compileRlsExpr("true ".repeat(200), COLS, rlsCtxFor("anon"))).toThrowError(DharaError);
  });

  it("documented limitation: whitespace after symbol operators fails closed with a parse error", () => {
    // Actual parser behavior: `=` must be immediately followed by a word char.
    // These throw DharaError (query rejected) rather than producing wrong SQL.
    expect(() => compileRlsExpr("owner_id = auth.uid()", COLS, rlsCtxFor("authenticated", "u"))).toThrowError(DharaError);
    expect(() => compileRlsExpr("title = 'x'", COLS, rlsCtxFor("anon"))).toThrowError(DharaError);
    expect(() => compileRlsExpr("owner_id > 5", COLS, rlsCtxFor("anon"))).toThrowError(DharaError);
    // word operators are unaffected
    expect(() => compileRlsExpr("title like 'x'", COLS, rlsCtxFor("anon"))).not.toThrow();
  });

  it("rejects unterminated string literals and trailing garbage", () => {
    expect(() => compileRlsExpr("title like 'x", COLS, rlsCtxFor("anon"))).toThrowError(DharaError);
    expect(() => compileRlsExpr("title like 'x' extra", COLS, rlsCtxFor("anon"))).toThrowError(DharaError);
  });
});
