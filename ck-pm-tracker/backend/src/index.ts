import express from "express";
import cors from "cors";
import "dotenv/config";
import { auth } from "./middleware/auth";
import { api } from "./routes/api";

const app = express();

const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(cors({ origin: origins.includes("*") ? true : origins }));
app.use(express.json({ limit: "2mb" }));
app.use(auth);
app.use("/api", api);
app.use((_req, res) => res.status(404).json({ error: "not_found" }));

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`PM API listening on :${port}`));
