// require('dotenv').config(); 

// const express = require("express");
// const { ethers } = require("ethers");
// const cors = require("cors");
// const fetch = global.fetch; 

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
//   console.error("CONTRACT_ADDRESS is invalid");
//   process.exit(1);
// }

// const ABI = [
//   "function getMetadataCount() view returns (uint)",
//   "function getMetadata(uint) view returns (string,string,uint256,string)"
// ];

// const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
// const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// // API endpoint
// app.get("/product-data", async (req, res) => { 
//   try {
//     const count = await contract.getMetadataCount();
//     const results = [];

//     for (let i = 0; i < count; i++) {
//       const record = await contract.getMetadata(i);
//       const cid = record[0];
//       // const hash = record[1];
//       const hash = record[1];
//       const timestamp = record[2];
//       const status = record[3];

//       const ipfsURL = `https://gray-peaceful-earwig-933.mypinata.cloud/ipfs/${cid}`;
//       try {
//         const response = await fetch(ipfsURL);
//         const json = await response.json();
//         results.push({ cid, hash, timestamp: timestamp.toString(), status, data: json });
//       } catch {
//         results.push({ cid, hash, timestamp: timestamp.toString(), status, data: "IPFS fetch failed" });
//       }
//     }

//     res.json(results);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));




require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");
const fetch = global.fetch;
const crypto = require("crypto");

const app = express();
app.use(cors());

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

//
// -----------------------------
// Contract setup
// -----------------------------
const ABI = [
  "function getMetadataCount() view returns (uint256)",
  "function getMetadata(uint256) view returns (string,string,uint256,string)"
];

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

//
// ===================================================================
// 🔴 EXACT SAME HASH LOGIC AS LAMBDA (DO NOT MODIFY EVER AGAIN)
// ===================================================================
//

// Deep sort (Python sort_keys=True)
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

// Escape unicode AFTER stringify (Python ensure_ascii=True)
function escapeUnicodeAfterStringify(jsonStr) {
  return jsonStr.replace(/[\u007F-\uFFFF]/g, (char) =>
    "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

// Python canonical JSON string
function pythonCanonicalJSONString(obj) {
  const sorted = deepSort(obj);

  let jsonStr = JSON.stringify(sorted);
  jsonStr = jsonStr.replace(/: /g, ":").replace(/, /g, ",");
  jsonStr = escapeUnicodeAfterStringify(jsonStr);

  return jsonStr;
}

// SHA256
function computeHash(data) {
  const canonicalJSON = pythonCanonicalJSONString(data);
  return crypto.createHash("sha256").update(canonicalJSON, "utf8").digest("hex");
}

//
// ===================================================================
// API ENDPOINT
// ===================================================================
//
app.get("/product-data", async (req, res) => {
  try {
    const requestedContainerID = req.query.containerID;
    if (!requestedContainerID)
      return res.status(400).json({ error: "containerID query param required" });

    const count = await contract.getMetadataCount();
    const results = [];

    for (let i = 0; i < count; i++) {
      const record = await contract.getMetadata(i);

      const cid = record[0];
      const blockchainHash = record[1];
      const timestamp = record[2];
      const status = record[3];

      const ipfsURL = `https://gray-peaceful-earwig-933.mypinata.cloud/ipfs/${cid}`;

      try {
        const response = await fetch(ipfsURL);
        const data = await response.json();

        // Filter by containerID
        if (data.containerID !== requestedContainerID) continue;

        // 🔴 recompute hash EXACTLY like Lambda
        const computedHash = computeHash(data);
        const verified = computedHash === blockchainHash;

        results.push({
          cid,
          blockchainHash,
          computedHash,
          verified,
          timestamp: timestamp.toString(),
          status,
          data
        });

      } catch (err) {
        results.push({
          cid,
          blockchainHash,
          computedHash: null,
          verified: false,
          timestamp: timestamp.toString(),
          status,
          data: "IPFS fetch failed"
        });
      }
    }

    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);