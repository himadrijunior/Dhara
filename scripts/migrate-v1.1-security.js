/* Dhara v1.1 security migration:
   1) DHARA_PROJECTS.OWNER_ID column (tenant isolation)
   2) Backfill owner id from platform owner user
   3) DHARA_OWNER_UQ — only ONE platform owner can ever exist (CWE-367 race)
*/
const oracledb = require("oracledb");
const fs = require("fs");
const path = require("path");

const CFG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", ".dhara", "config.json"), "utf8")
);

async function main() {
  oracledb.fetchAsString = [oracledb.CLOB];
  const conn = await oracledb.getConnection({
    user: CFG.oracle.user,
    password: CFG.oracle.password,
    connectString: CFG.oracle.connectString,
    walletLocation: CFG.oracle.walletDir || path.join(__dirname, "..", ".dhara", "wallet"),
    walletPassword: CFG.oracle.walletPassword,
  });
  const log = (...a) => console.log("[migrate]", ...a);

  // 1) OWNER_ID column
  try {
    await conn.execute(`ALTER TABLE DHARA_PROJECTS ADD (OWNER_ID VARCHAR2(36))`);
    log("added DHARA_PROJECTS.OWNER_ID");
  } catch (e) {
    if (/ORA-01430/.test(String(e.message))) log("OWNER_ID already exists");
    else throw e;
  }

  // 2) backfill from first owner user
  const r = await conn.execute(
    `SELECT COUNT(*) N FROM DHARA_PROJECTS WHERE OWNER_ID IS NULL`
  );
  if (Number(r.rows[0].N) > 0) {
    await conn.execute(
      `UPDATE DHARA_PROJECTS P
         SET OWNER_ID = (SELECT U.ID FROM DHARA_USERS U WHERE U.ROLE = 'owner' AND ROWNUM = 1)
       WHERE P.OWNER_ID IS NULL`
    );
    log(`backfilled OWNER_ID on ${r.rows[0].N} project(s)`);
  } else {
    log("no NULL OWNER_ID rows");
  }

  // 3) unique single-owner index
  try {
    await conn.execute(
      `CREATE UNIQUE INDEX DHARA_OWNER_UQ ON DHARA_USERS (CASE WHEN ROLE = 'owner' THEN 1 ELSE NULL END)`
    );
    log("created DHARA_OWNER_UQ");
  } catch (e) {
    if (/ORA-00955|ORA-01408/.test(String(e.message))) log("DHARA_OWNER_UQ already exists");
    else throw e;
  }

  await conn.commit();
  const v = await conn.execute(
    `SELECT P.ID, P.NAME, P.OWNER_ID, U.ROLE FROM DHARA_PROJECTS P LEFT JOIN DHARA_USERS U ON U.ID = P.OWNER_ID`
  );
  log("projects:", JSON.stringify(v.rows));
  await conn.close();
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e.message);
  process.exit(1);
});
