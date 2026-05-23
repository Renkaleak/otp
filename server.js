const express = require("express");
const app     = express();

const ivasRouter = require("./ivasms");   // router IVAS SMS
require("./bot");                          // jalankan bot Telegram

app.use(express.json());
app.use("/api/ivasms", ivasRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server jalan di http://localhost:${PORT}`);
});
