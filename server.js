
// require("dotenv").config();
// const express = require("express");
// const { ethers } = require("ethers");
// const cors = require("cors");
// const fetch = global.fetch;
// const crypto = require("crypto");

// const app = express();
// app.use(cors());

// const PORT = process.env.PORT || 3000;
// const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS?.trim();
// const SEPOLIA_RPC = process.env.SEPOLIA_RPC?.trim();

// if (!CONTRACT_ADDRESS || !SEPOLIA_RPC) {
//   console.error("Missing .env variables");
//   process.exit(1);
// }

// if (!ethers.isAddress(CONTRACT_ADDRESS)) {
//   console.error("Invalid CONTRACT_ADDRESS");
//   process.exit(1);
// }

// //
// // -----------------------------
// // Contract setup
// // -----------------------------
// const ABI = [
//   "function getMetadataCount() view returns (uint256)",
//   "function getMetadata(uint256) view returns (string,string,uint256,string)"
// ];

// const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
// const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);


// // Deep sort (Python sort_keys=True)
// function deepSort(obj) {
//   if (Array.isArray(obj)) return obj.map(deepSort);

//   if (obj !== null && typeof obj === "object") {
//     return Object.keys(obj)
//       .sort()
//       .reduce((acc, key) => {
//         acc[key] = deepSort(obj[key]);
//         return acc;
//       }, {});
//   }
//   return obj;
// }

// // Escape unicode AFTER stringify (Python ensure_ascii=True)
// function escapeUnicodeAfterStringify(jsonStr) {
//   return jsonStr.replace(/[\u007F-\uFFFF]/g, (char) =>
//     "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0")
//   );
// }

// // Python canonical JSON string
// function pythonCanonicalJSONString(obj) {
//   const sorted = deepSort(obj);

//   let jsonStr = JSON.stringify(sorted);
//   jsonStr = jsonStr.replace(/: /g, ":").replace(/, /g, ",");
//   jsonStr = escapeUnicodeAfterStringify(jsonStr);

//   return jsonStr;
// }

// // SHA256
// function computeHash(data) {
//   const canonicalJSON = pythonCanonicalJSONString(data);
//   return crypto.createHash("sha256").update(canonicalJSON, "utf8").digest("hex");
// }

// //
// // ===================================================================
// // API ENDPOINT
// // ===================================================================
// //
// app.get("/product-data", async (req, res) => {
//   try {
//     const requestedContainerID = req.query.containerID;
//     if (!requestedContainerID)
//       return res.status(400).json({ error: "containerID query param required" });

//     const count = await contract.getMetadataCount();
//     const results = [];

//     for (let i = 0; i < count; i++) {
//       const record = await contract.getMetadata(i);

//       const cid = record[0];
//       const blockchainHash = record[1];
//       const timestamp = record[2];
//       const status = record[3];

//       const ipfsURL = `https://gray-peaceful-earwig-933.mypinata.cloud/ipfs/${cid}`;

//       try {
//         const response = await fetch(ipfsURL);
//         const data = await response.json();

//         // Filter by containerID
//         if (data.containerID !== requestedContainerID) continue;

//         // recompute hash EXACTLY like Lambda
//         const computedHash = computeHash(data);
//         const verified = computedHash === blockchainHash;

//         results.push({
//           cid,
//           blockchainHash,
//           computedHash,
//           verified,
//           timestamp: timestamp.toString(),
//           status,
//           data
//         });

//       } catch (err) {
//         results.push({
//           cid,
//           blockchainHash,
//           computedHash: null,
//           verified: false,
//           timestamp: timestamp.toString(),
//           status,
//           data: "IPFS fetch failed"
//         });
//       }
//     }

//     res.json(results);

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// app.listen(PORT, () =>
//   console.log(`Server running at http://localhost:${PORT}`)
// );



require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(
  cors({ exposedHeaders: ["X-Unresolved-Records", "X-Chain-Partial", "X-Chain-Records"] })
);

const PORT = process.env.PORT || 3000;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS?.trim();
const SEPOLIA_RPC = process.env.SEPOLIA_RPC?.trim();

if (!CONTRACT_ADDRESS || !SEPOLIA_RPC) {
  console.error("Missing .env variables");
  process.exit(1);
}
if (!ethers.isAddress(CONTRACT_ADDRESS)) {
  console.error("Invalid CONTRACT_ADDRESS");
  process.exit(1);
}

// -----------------------------------------------------------------
// IPFS gateways (IPFS_GATEWAYS or IPFS_GATEWAY, comma-separated)
// -----------------------------------------------------------------
const normalizeGateway = (url) => {
  const base = url.replace(/\/+$/, "");
  return /\/ipfs$/.test(base) ? base : `${base}/ipfs`;
};

// All gateway URLs come from environment variables (comma-separated lists):
//   IPFS_GATEWAYS         primary gateways, all raced immediately (e.g. new + old Pinata gateway)
//   IPFS_PUBLIC_GATEWAYS  optional last-resort gateways, started after a short delay
const parseList = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeGateway);

const configuredGateways = [...new Set(parseList(process.env.IPFS_GATEWAYS || process.env.IPFS_GATEWAY))];
const publicGateways = [...new Set(parseList(process.env.IPFS_PUBLIC_GATEWAYS))];

const GATEWAYS = [...new Set([...configuredGateways, ...publicGateways])];
const CONFIGURED_COUNT = configuredGateways.length;

if (GATEWAYS.length === 0) {
  console.error("No IPFS gateway configured. Set IPFS_GATEWAYS in the environment variables.");
  process.exit(1);
}
console.log(`IPFS gateways in use (${GATEWAYS.length}):`, GATEWAYS.join(", "));

// -----------------------------------------------------------------
// Tuning
// -----------------------------------------------------------------
const GATEWAY_TIMEOUT_MS = 5000; // per HTTP attempt
const GATEWAY_RETRIES = 3; // per gateway, only for 429 / 5xx / timeouts / network errors
const PUBLIC_HEDGE_MS = 1500; // public gateways start only if configured ones are slow
const CONFIGURED_GATEWAY_CONCURRENCY = 4; // max simultaneous requests per dedicated gateway
const PUBLIC_GATEWAY_CONCURRENCY = 2;
const REQUEST_WAIT_MS = 8500; // max time one request waits for IPFS
const IPFS_CONCURRENCY = 8;
const RPC_CONCURRENCY = 4;
const CHAIN_BATCH = 20;
const COUNT_TTL_MS = 5000;
const UNRESOLVED_RETRY_MS = 15 * 1000;

// -----------------------------------------------------------------
// Contract setup
// -----------------------------------------------------------------
const ABI = [
  "function getMetadataCount() view returns (uint256)",
  "function getMetadata(uint256) view returns (string,string,uint256,string)",
];

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// -----------------------------------------------------------------
// Canonical hashing (unchanged: must match the Lambda exactly)
// -----------------------------------------------------------------
function deepSort(obj) {
  if (Array.isArray(obj)) return obj.map(deepSort);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = deepSort(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

function escapeUnicodeAfterStringify(jsonStr) {
  return jsonStr.replace(/[\u007F-\uFFFF]/g, (char) =>
    "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

function pythonCanonicalJSONString(obj) {
  const sorted = deepSort(obj);
  let jsonStr = JSON.stringify(sorted);
  jsonStr = jsonStr.replace(/: /g, ":").replace(/, /g, ",");
  jsonStr = escapeUnicodeAfterStringify(jsonStr);
  return jsonStr;
}

function computeHash(data) {
  const canonicalJSON = pythonCanonicalJSONString(data);
  return crypto.createHash("sha256").update(canonicalJSON, "utf8").digest("hex");
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
}

const isRateLimited = (err) => /Too Many Requests|-32005|429/.test(String(err?.message ?? ""));

async function withRetry(fn, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimited(err) || i >= attempts - 1) throw err;
      await sleep(400 * 2 ** i);
    }
  }
}

// Container IDs are compared case-insensitively and trimmed.
const normId = (v) => String(v ?? "").trim().toUpperCase();
const containerOf = (data) => data.containerID ?? data.containerId ?? data.container_id;

// -----------------------------------------------------------------
// Blockchain records (immutable: cached by index, only new ones are read)
// -----------------------------------------------------------------
const chainCache = [];
let countCache = { value: 0, at: 0 };
let syncPromise = null;

async function getCount() {
  if (Date.now() - countCache.at < COUNT_TTL_MS) return countCache.value;
  const value = Number(await withRetry(() => contract.getMetadataCount()));
  countCache = { value, at: Date.now() };
  return value;
}

async function doSync() {
  const count = await getCount();
  for (let start = chainCache.length; start < count; start += CHAIN_BATCH) {
    const indices = Array.from({ length: Math.min(CHAIN_BATCH, count - start) }, (_, k) => start + k);
    const batch = await mapLimit(indices, RPC_CONCURRENCY, (i) => withRetry(() => contract.getMetadata(i)));
    for (const rec of batch) {
      chainCache.push({
        cid: rec[0],
        blockchainHash: rec[1],
        timestamp: rec[2].toString(),
        status: rec[3],
      });
    }
  }
  return chainCache.slice(0, count);
}

function syncChain() {
  if (!syncPromise) syncPromise = doSync().finally(() => (syncPromise = null));
  return syncPromise;
}

// -----------------------------------------------------------------
// IPFS files: content-addressed, so a successful fetch is cached forever.
//  - every gateway has its own concurrency limiter (Pinata rate-limits bursts)
//  - 429 / 5xx / timeouts are retried with backoff; 404 / 403 are final for that gateway
//  - gateways are raced; public ones are hedged (start late)
//  - in-flight fetches are shared between requests
// -----------------------------------------------------------------
const ipfsCache = new Map(); // cid -> parsed JSON
const unresolved = new Map(); // cid -> { at, error }
const inflight = new Map(); // cid -> Promise<data|null>
const limiters = new Map(
  GATEWAYS.map((g, i) => [
    g,
    createLimiter(i < CONFIGURED_COUNT ? CONFIGURED_GATEWAY_CONCURRENCY : PUBLIC_GATEWAY_CONCURRENCY),
  ])
);

async function fetchOnce(gateway, cid, outerSignal) {
  const tc = new AbortController();
  const onAbort = () => tc.abort();
  outerSignal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => tc.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(`${gateway}/${cid}`, { signal: tc.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get("retry-after")) || 0;
      throw err;
    }
    const data = await res.json();
    if (!data || typeof data !== "object") {
      throw Object.assign(new Error("not a JSON object"), { fatal: true });
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") err.message = outerSignal.aborted ? "cancelled" : "timeout";
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onAbort);
  }
}

async function tryGateway(gateway, cid, signal) {
  const limit = limiters.get(gateway);
  let lastErr;
  for (let n = 0; n < GATEWAY_RETRIES; n++) {
    if (signal.aborted) throw new Error("cancelled");
    try {
      return await limit(() => fetchOnce(gateway, cid, signal));
    } catch (err) {
      lastErr = err;
      const retryable = !err.fatal && (err.status === undefined || err.status === 429 || err.status >= 500);
      if (!retryable || n === GATEWAY_RETRIES - 1) break;
      await sleep(err.retryAfter ? Math.min(err.retryAfter * 1000, 3000) : 300 * 2 ** n);
    }
  }
  throw lastErr;
}

async function raceGateways(cid) {
  const controllers = GATEWAYS.map(() => new AbortController());
  const errors = [];

  const attempts = GATEWAYS.map(async (gateway, i) => {
    if (i >= CONFIGURED_COUNT && CONFIGURED_COUNT > 0) {
      await sleep(PUBLIC_HEDGE_MS);
      if (controllers[i].signal.aborted) throw new Error("cancelled");
    }
    try {
      return await tryGateway(gateway, cid, controllers[i].signal);
    } catch (err) {
      if (err.message !== "cancelled") errors.push(`${gateway}: ${err.message}`);
      throw err;
    }
  });

  try {
    const data = await Promise.any(attempts);
    controllers.forEach((c) => c.abort());
    return { data };
  } catch {
    return { data: null, error: errors.join(" | ") || "all gateways failed" };
  }
}

function getIpfsJson(cid) {
  if (ipfsCache.has(cid)) return Promise.resolve(ipfsCache.get(cid));

  const failed = unresolved.get(cid);
  if (failed && Date.now() - failed.at < UNRESOLVED_RETRY_MS) return Promise.resolve(null);

  if (inflight.has(cid)) return inflight.get(cid);

  const p = raceGateways(cid)
    .then(({ data, error }) => {
      if (data) {
        ipfsCache.set(cid, data);
        unresolved.delete(cid);
        return data;
      }
      unresolved.set(cid, { at: Date.now(), error });
      return null;
    })
    .finally(() => inflight.delete(cid));

  inflight.set(cid, p);
  return p;
}

// Loads every file (cached ones return instantly) and waits at most REQUEST_WAIT_MS.
async function loadFiles(chain) {
  const work = mapLimit(chain, IPFS_CONCURRENCY, (rec) => getIpfsJson(rec.cid));
  await Promise.race([work, sleep(REQUEST_WAIT_MS)]);
}

// ===================================================================
// API ENDPOINTS
// ===================================================================
// GET /product-data?containerID=XXXX            -> array of verified records
// GET /product-data?containerID=XXXX&debug=1    -> { results, skipped, summary } (why anything was dropped)
app.get("/product-data", async (req, res) => {
  try {
    const requestedContainerID = req.query.containerID;
    if (typeof requestedContainerID !== "string" || !requestedContainerID.trim()) {
      return res.status(400).json({ error: "containerID query param required" });
    }
    const wanted = normId(requestedContainerID);
    const debug = req.query.debug === "1";

    // 1. On-chain records. On RPC failure serve the cache, but say so if it is incomplete.
    let chain;
    let chainPartial = false;
    try {
      chain = await syncChain();
    } catch (err) {
      if (chainCache.length === 0) throw err;
      console.warn("RPC unavailable, serving cached chain records:", err.message);
      chain = chainCache.slice();
      chainPartial = chain.length < countCache.value;
    }

    // 2. IPFS files.
    await loadFiles(chain);

    // 3. Filter by container and verify against the on-chain hash.
    const results = [];
    const skipped = [];

    chain.forEach((rec, i) => {
      const data = ipfsCache.get(rec.cid);
      if (!data) {
        skipped.push({
          index: i,
          cid: rec.cid,
          reason: "unresolved",
          detail: unresolved.get(rec.cid)?.error ?? "still loading",
        });
        return;
      }
      const found = containerOf(data);
      if (normId(found) !== wanted) {
        skipped.push({ index: i, cid: rec.cid, reason: "other-container", detail: String(found) });
        return;
      }

      const computedHash = computeHash(data);
      results.push({
        cid: rec.cid,
        blockchainHash: rec.blockchainHash,
        computedHash,
        verified: computedHash === rec.blockchainHash,
        timestamp: rec.timestamp,
        status: rec.status,
        data,
      });
    });

    const unresolvedCount = skipped.filter((s) => s.reason === "unresolved").length;
    if (unresolvedCount > 0) console.warn(`${unresolvedCount} record(s) could not be fetched from any IPFS gateway`);
    if (chainPartial) console.warn("Chain list is partial");

    res.set("X-Unresolved-Records", String(unresolvedCount));
    res.set("X-Chain-Partial", String(chainPartial));
    res.set("X-Chain-Records", String(chain.length));

    if (debug) {
      return res.json({
        summary: {
          requestedContainerID,
          chainRecords: chain.length,
          chainPartial,
          matched: results.length,
          unresolved: unresolvedCount,
          otherContainer: skipped.length - unresolvedCount,
        },
        results,
        skipped,
      });
    }
    res.json(results);
  } catch (err) {
    console.error(err);
    if (isRateLimited(err)) {
      return res.status(503).json({ error: "Blockchain RPC is rate limited. Try again in a moment." });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    chainRecordsCached: chainCache.length,
    ipfsFilesCached: ipfsCache.size,
    ipfsFilesUnresolved: unresolved.size,
    gateways: GATEWAYS,
  });
});

// Every on-chain record, the container its file belongs to, or why it failed.
app.get("/debug/records", async (req, res) => {
  try {
    const chain = await syncChain();
    await loadFiles(chain);
    const rows = chain.map((rec, i) => {
      const data = ipfsCache.get(rec.cid);
      return {
        index: i,
        cid: rec.cid,
        resolved: !!data,
        containerID: data ? containerOf(data) ?? "(no container field)" : null,
        data_name: data?.data_name ?? null,
        verified: data ? computeHash(data) === rec.blockchainHash : null,
        error: data ? null : unresolved.get(rec.cid)?.error ?? "still loading",
      };
    });
    const byContainer = {};
    rows.forEach((r) => {
      const k = r.resolved ? r.containerID : "UNRESOLVED";
      byContainer[k] = (byContainer[k] || 0) + 1;
    });
    res.json({ total: rows.length, byContainer, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

module.exports = app; // required for Vercel