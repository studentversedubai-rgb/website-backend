const express = require("express");
const cors = require("cors");
require("dotenv").config();
const contactRoutes = require("./contact");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/contact", contactRoutes);

const PORT = process.env.PORT || 3000;

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
