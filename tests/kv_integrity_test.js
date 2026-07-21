// Phase 3 - KV / scenario-share integrity test.
//
// Verifies the homepilot-scenario-share Worker's save/load contract, including
// malformed-input and expiry edge cases, following the pattern established by
// the "verify before acting" rule elsewhere in this project.
//
// SAFETY: this test ONLY ever runs `wrangler dev --local`. Local mode simulates
// KV entirely in-memory on this machine — it never makes a network call to
// Cloudflare, and never touches the real production SCENARIO_KV data, even
// though the Worker's wrangler.jsonc still references the real namespace ID.
// This script does not (and must never) pass --remote.
//
// Run: node tests/kv_integrity_test.js
// Requires: npm install (installs wrangler as a devDependency)

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKER_SRC = path.join(
  __dirname,
  "..",
  "workers",
  "RECONSTRUCTED_homepilot-scenario-share",
  "index.js"
);
const WORKER_CONFIG = path.join(
  __dirname,
  "..",
  "workers",
  "RECONSTRUCTED_homepilot-scenario-share",
  "wrangler.jsonc"
);
const WRANGLER_BIN = path.join(__dirname, "..", "node_modules", ".bin", "wrangler");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + JSON.stringify(detail) : ""}`);
  }
}

// Builds a throwaway config+worker pair in a temp dir. Wrangler requires a
// lowercase-with-dashes "name" field; the real file's name intentionally has
// -RECONSTRUCTED (mixed case) as a deploy-safety guard, so we only rename it
// in this disposable copy. ttlOverrideSeconds optionally patches TTL_SECONDS
// for the expiry sub-test, so we don't have to wait 180 days to prove expiry
// actually works.
function makeTempWorkerDir(nameSuffix, ttlOverrideSeconds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-kv-test-"));
  let src = fs.readFileSync(WORKER_SRC, "utf8");
  if (ttlOverrideSeconds) {
    src = src.replace(
      /const TTL_SECONDS = .+?;.*\n/,
      `const TTL_SECONDS = ${ttlOverrideSeconds}; // TEST OVERRIDE for expiry verification\n`
    );
  }
  fs.writeFileSync(path.join(dir, "index.js"), src);

  let config = fs.readFileSync(WORKER_CONFIG, "utf8");
  config = config.replace(
    /"name":\s*"[^"]+"/,
    `"name": "homepilot-scenario-share-${nameSuffix}"`
  );
  fs.writeFileSync(path.join(dir, "wrangler.jsonc"), config);

  return dir;
}

function startWrangler(configDir, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      WRANGLER_BIN,
      ["dev", "--local", "--port", String(port), "--config", path.join(configDir, "wrangler.jsonc")],
      { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    const onData = (d) => {
      out += d.toString();
      if (out.includes("Ready on")) {
        proc.stdout.off("data", onData);
        resolve(proc);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    const timeout = setTimeout(() => {
      reject(new Error("wrangler dev did not become ready in time:\n" + out));
    }, 20000);
    proc.on("exit", () => clearTimeout(timeout));
    resolve.timeout = timeout;
  });
}

function stopWrangler(proc) {
  return new Promise((resolve) => {
    proc.on("exit", resolve);
    proc.kill("SIGTERM");
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch (e) {}
      resolve();
    }, 3000);
  });
}

async function runCoreSuite(port) {
  console.log("\n--- Core save/load + malformed-input + CORS suite ---");
  const base = `http://localhost:${port}`;
  const origin = "https://myhomepilot.ca";

  // 1. Normal save
  const saveRes = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ inc: 108000, dn: 60000, dbt: 0, fam: "3", wa: "remote", wp: "", rate: 4.19 }),
  });
  const saveBody = await saveRes.json();
  check("save returns 200 + ok:true + an id", saveRes.status === 200 && saveBody.ok === true && !!saveBody.id, saveBody);

  const id = saveBody.id;

  // 2. Load it back
  const loadRes = await fetch(`${base}/load?id=${id}`, { headers: { Origin: origin } });
  const loadBody = await loadRes.json();
  check(
    "load returns the exact saved data",
    loadBody.inc === 108000 && loadBody.dn === 60000 && loadBody.wa === "remote",
    loadBody
  );

  // 3. Load a nonexistent id
  const missRes = await fetch(`${base}/load?id=doesNotExist99`, { headers: { Origin: origin } });
  const missBody = await missRes.json();
  check("load of unknown id returns ok:false/not_found, not a crash", missBody.ok === false && missBody.error === "not_found", missBody);

  // 4. Load with no id param
  const noIdRes = await fetch(`${base}/load`, { headers: { Origin: origin } });
  const noIdBody = await noIdRes.json();
  check("load with no id param is rejected cleanly", noIdBody.ok === false && noIdBody.error === "missing_id", noIdBody);

  // 5. Save malformed JSON
  const badJsonRes = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: "not json{{{",
  });
  const badJsonBody = await badJsonRes.json();
  check("save with malformed JSON is rejected cleanly", badJsonBody.ok === false && badJsonBody.error === "invalid_json", badJsonBody);

  // 6. Save empty payload
  const emptyRes = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: "{}",
  });
  const emptyBody = await emptyRes.json();
  check("save with empty payload is rejected cleanly", emptyBody.ok === false && emptyBody.error === "empty_payload", emptyBody);

  // 7. Save with only unrecognized/junk keys (should be filtered to nothing and rejected)
  const junkRes = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ foo: "bar", hacked: true }),
  });
  const junkBody = await junkRes.json();
  check(
    "save with only unrecognized keys is filtered out and rejected (allowlist works)",
    junkBody.ok === false && junkBody.error === "empty_payload",
    junkBody
  );

  // 8. CORS from a disallowed origin should NOT be echoed back
  const corsRes = await fetch(`${base}/load?id=${id}`, { headers: { Origin: "https://evil-site.com" } });
  const allowOrigin = corsRes.headers.get("access-control-allow-origin");
  check(
    "disallowed origin does not get its own value echoed in CORS header",
    allowOrigin !== "https://evil-site.com",
    { allowOrigin }
  );
}

async function runExpirySuite(port) {
  console.log("\n--- Expiry suite (60s TTL override, not the real 180 days) ---");
  const base = `http://localhost:${port}`;
  const origin = "https://myhomepilot.ca";

  const saveRes = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ inc: 90000, dn: 40000, dbt: 0, fam: "2", wa: "hybrid", wp: "M5V", rate: 4.19 }),
  });
  const saveBody = await saveRes.json();
  check("expiry-test save succeeds", saveBody.ok === true && !!saveBody.id, saveBody);
  const id = saveBody.id;

  const immediateRes = await fetch(`${base}/load?id=${id}`, { headers: { Origin: origin } });
  const immediateBody = await immediateRes.json();
  check("data is retrievable immediately after save", immediateBody.inc === 90000, immediateBody);

  console.log("  ...waiting 70s for the 60s TTL to elapse...");
  await new Promise((r) => setTimeout(r, 70000));

  const afterRes = await fetch(`${base}/load?id=${id}`, { headers: { Origin: origin } });
  const afterBody = await afterRes.json();
  check("data is gone (not_found) after TTL elapses", afterBody.ok === false && afterBody.error === "not_found", afterBody);
}

(async () => {
  console.log("=== Phase 3: KV / scenario-share integrity test ===");
  console.log("(All requests run against `wrangler dev --local` — a fully in-memory");
  console.log(" simulated KV store. No network calls to Cloudflare, no real production data touched.)\n");

  const coreDir = makeTempWorkerDir("official-kvtest", null);
  const ttlDir = makeTempWorkerDir("official-kvtest-ttl", 60);

  let coreProc, ttlProc;
  try {
    coreProc = await startWrangler(coreDir, 8787);
    await runCoreSuite(8787);
  } finally {
    if (coreProc) await stopWrangler(coreProc);
    fs.rmSync(coreDir, { recursive: true, force: true });
  }

  try {
    ttlProc = await startWrangler(ttlDir, 8788);
    await runExpirySuite(8788);
  } finally {
    if (ttlProc) await stopWrangler(ttlProc);
    fs.rmSync(ttlDir, { recursive: true, force: true });
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Fatal error running KV integrity test:", e);
  process.exit(1);
});
