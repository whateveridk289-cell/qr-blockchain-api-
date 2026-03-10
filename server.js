const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors()); //enabling cors so mobile/browser can access the API

const PORT = process.env.PORT ||3000;
const CONTRACT_ADDRESS = "0xe574be6f8d5788f6deb55019d076edb584ddcb1b";
const ABI = [
  "function getMetadataCount() view returns (uint)",
  "function getMetadata(uint) view returns (string,string,uint256,string)"
];

// blockchain configuration
const provider = new ethers.JsonRpcProvider(
  "https://sepolia.infura.io/v3/149f1d6a4d8a4e979fb2b22f158d5f7e"
);

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

      const ipfsURL = `https://gray-peaceful-earwig-933.mypinata.cloud/ipfs/${cid}`;

      try {

        const response = await fetch(ipfsURL);
        const json = await response.json();

        results.push({
          cid: cid,
          timestamp: timestamp.toString(),
          status: status,
          data: json
        });

      } catch (ipfsError) {

        results.push({
          cid: cid,
          timestamp: timestamp.toString(),
          status: status,
          data: "IPFS fetch failed"
        });

      }

    }

    res.json(results);

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: error.message });

  }

});

// start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});