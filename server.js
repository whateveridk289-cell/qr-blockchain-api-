require('dotenv').config();

const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");
const fetch = require("node-fetch"); 

const app = express();
app.use(cors()); // Allow mobile app / browser access

// Config from .env
const PORT = process.env.PORT || 3000;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || "https://gray-peaceful-earwig-933.mypinata.cloud/ipfs/";

// ABI of your smart contract
const ABI = [
  "function getMetadataCount() view returns (uint)",
  "function getMetadata(uint) view returns (string,string,uint256,string)"
];

// Setup ethers provider & contract
const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// API endpoint to fetch all product metadata
app.get("/product-data", async (req, res) => {
  try {
    const count = await contract.getMetadataCount();
    let results = [];

    for (let i = 0; i < count; i++) {
      const record = await contract.getMetadata(i);

      const cid = record[0];
      const timestamp = record[2];
      const status = record[3];

      const ipfsURL = `${IPFS_GATEWAY}${cid}`;

      try {
        const response = await fetch(ipfsURL);
        const json = await response.json();

        results.push({
          cid,
          timestamp: timestamp.toString(),
          status,
          data: json
        });
      } catch (ipfsError) {
        results.push({
          cid,
          timestamp: timestamp.toString(),
          status,
          data: "IPFS fetch failed"
        });
      }
    }

    res.json(results);

  } catch (error) {
    console.error("Error fetching metadata:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});