const express = require("express");
const app     = express();

const ivasRouter = require("./ivasms");
require("./bot");

app.use(express.json());
app.use("/api/ivasms", ivasRouter);

// Health check — wajib untuk Railway agar container tidak di-kill
app.get("/", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// Tangkap error global agar bot tidak mati diam-diam
process.on("uncaughtException",  e => console.error("❌ uncaughtException:", e.message));
process.on("unhandledRejection", e => console.error("❌ unhandledRejection:", e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server jalan di port ${PORT}`);
});
