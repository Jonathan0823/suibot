import express from "express";
const app = express();
const port = process.env.PORT || 8000;

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.listen(port, () => {
  console.log(`Health check server running on port ${port}`);
});
