require('dotenv').config(); 

const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");
const fetch = global.fetch; 

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
  console.error("CONTRACT_ADDRESS is invalid");
  process.exit(1);
}

const ABI = [
  "function getMetadataCount() view returns (uint)",
  "function getMetadata(uint) view returns (string,string,uint256,string)"
];

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// API endpoint
app.get("/product-data", async (req, res) => { 
  try {
    const count = await contract.getMetadataCount();
    const results = [];

    for (let i = 0; i < count; i++) {
      const record = await contract.getMetadata(i);
      const cid = record[0];
      // const hash = record[1];
      const hash = record[1];
      const timestamp = record[2];
      const status = record[3];

      const ipfsURL = `https://gray-peaceful-earwig-933.mypinata.cloud/ipfs/${cid}`;
      try {
        const response = await fetch(ipfsURL);
        const json = await response.json();
        results.push({ cid, hash, timestamp: timestamp.toString(), status, data: json });
      } catch {
        results.push({ cid, hash, timestamp: timestamp.toString(), status, data: "IPFS fetch failed" });
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));