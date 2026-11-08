#!/usr/bin/env node
/** Dhara DB connectivity probe — reads credentials from .dhara/config.json (never hardcoded). */
const oracledb = require("/home/z/my-project/node_modules/oracledb");
const fs = require("fs");

const cfg = JSON.parse(fs.readFileSync("/home/z/my-project/.dhara/config.json", "utf8"));
const W = cfg.oracle.walletDir;
const user = cfg.oracle.user;
const password = cfg.oracle.password;

// full TNS descriptor fallback (no configDir needed)
const tns = fs.readFileSync(`${W}/tnsnames.ora`, "utf8");
const alias = cfg.oracle.connectString;
const re = new RegExp(`${alias}\\s*=\\s*([\\s\\S]*?)\\n\\s*\\n`);
const m = tns.match(re);
const desc = m ? m[1].replace(/\s+/g, " ").trim() : null;
console.log("descriptor extracted:", !!desc, "| alias:", alias, "| user:", user);

// candidate wallet passwords from ojdbc.properties (never printed)
const props = fs.readFileSync(`${W}/ojdbc.properties`, "utf8");
const cands = [...new Set(
  [...props.matchAll(/(?:keyStore|trustStore)Password\s*=\s*(\S+)/g)].map(x => x[1])
)];
console.log("candidate wallet pw count:", cands.length);

async function tryConn(label, opts) {
  const t0 = Date.now();
  try {
    const conn = await oracledb.getConnection({ user, password, ...opts });
    const r = await conn.execute("select 1 from dual");
    console.log(`OK  [${label}] in ${Date.now() - t0}ms ->`, r.rows[0][0]);
    await conn.close();
    return true;
  } catch (e) {
    console.log(`ERR [${label}] after ${Date.now() - t0}ms: ${e.message.slice(0, 110)}`);
    return false;
  }
}

(async () => {
  // 1. SSO wallet + alias (needs configDir)
  if (await tryConn("sso+configDir+alias", {
    connectString: alias, walletLocation: W, configDir: W,
  })) return process.exit(0);
  // 2. SSO wallet + full descriptor (no configDir)
  if (desc && await tryConn("sso+descriptor", { connectString: desc, walletLocation: W })) {
    fs.writeFileSync("/tmp/probe_result", "sso+descriptor", { mode: 0o600 });
    return process.exit(0);
  }
  // 3. PKCS12 + wallet password candidates
  for (const pw of cands) {
    if (await tryConn("p12+walletPassword+alias", {
      connectString: alias, walletLocation: W, configDir: W, walletPassword: pw,
    })) {
      fs.writeFileSync("/tmp/wallet_pw_ok", pw, { mode: 0o600 });
      console.log("WORKING_WALLET_PW saved to /tmp/wallet_pw_ok");
      return process.exit(0);
    }
  }
  process.exit(1);
})();
