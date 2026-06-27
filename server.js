const express = require("express");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");

// ── Cookies: спочатку з env, якщо немає — шукаємо файл ──────────────────────
const cookiesEnv = process.env.YOUTUBE_COOKIES;
if (cookiesEnv) {
  fs.writeFileSync(COOKIES_PATH, cookiesEnv, "utf8");
  console.log("✅ cookies.txt створено з env змінної");
}

if (fs.existsSync(COOKIES_PATH)) {
  console.log("✅ cookies.txt знайдено:", COOKIES_PATH);
} else {
  console.log("⚠️  cookies.txt НЕ знайдено — YouTube може блокувати запити");
}

function getCookiesArgs() {
  if (fs.existsSync(COOKIES_PATH)) return ["--cookies", COOKIES_PATH];
  return [];
}

function getCookiesFlag() {
  if (fs.existsSync(COOKIES_PATH)) return `--cookies "${COOKIES_PATH}"`;
  return "";
}
// ────────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Авто-очистка старих файлів кожні 30 хв
setInterval(() => {
  const now = Date.now();
  try {
    fs.readdirSync(DOWNLOADS_DIR).forEach((file) => {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(filePath);
    });
  } catch (e) {
    console.error("Cleanup error:", e.message);
  }
}, 30 * 60 * 1000);

// GET /api/info
app.get("/api/info", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const cookiesFlag = getCookiesFlag();
  const cmd = `yt-dlp --dump-json --no-warnings ${cookiesFlag} "${url}"`;
  console.log("▶ Running:", cmd);

  exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("yt-dlp info error:", stderr || err.message);
      return res.status(500).json({ error: "Failed to fetch video info. Make sure the URL is valid and public." });
    }
    try {
      const jsonLine = stdout.split("\n").find((l) => l.trim().startsWith("{"));
      if (!jsonLine) throw new Error("No JSON in output");
      const info = JSON.parse(jsonLine);

      const formats = (info.formats || [])
        .filter((f) => f.vcodec !== "none" && f.acodec !== "none")
        .map((f) => ({
          format_id: f.format_id,
          label: `${f.height ? f.height + "p" : "?"} — ${f.ext} (${f.format_note || ""})`,
          height: f.height || 0,
          ext: f.ext,
        }))
        .sort((a, b) => b.height - a.height);

      const seen = new Set();
      const unique = formats.filter((f) => {
        if (seen.has(f.height)) return false;
        seen.add(f.height);
        return true;
      });

      const options = [
        { format_id: "bestvideo+bestaudio/best", label: "🏆 Найкраща якість (авто)", height: 9999 },
        ...unique,
      ];

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        platform: info.extractor_key,
        formats: options,
      });
    } catch (parseErr) {
      console.error("Parse error:", parseErr.message);
      res.status(500).json({ error: "Could not parse video info" });
    }
  });
});

// In-memory job store
const jobs = new Map();

// POST /api/download
app.post("/api/download", (req, res) => {
  const { url, format_id, start_time, end_time } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const jobId = uuidv4();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);

  const args = [
    "--no-warnings",
    ...getCookiesArgs(),
    "-f", format_id || "bestvideo+bestaudio/best",
    "--merge-output-format", "mp4",
    "-o", outputTemplate,
  ];

  if (start_time || end_time) {
    args.push("--download-sections", `*${start_time || "0"}-${end_time || "inf"}`);
    args.push("--force-keyframes-at-cuts");
  }

  args.push(url);

  console.log("▶ yt-dlp args:", args.join(" "));
  res.json({ jobId });

  const job = { id: jobId, status: "downloading", progress: 0, filename: null, error: null };
  jobs.set(jobId, job);

  const proc = spawn("yt-dlp", args);

  proc.stdout.on("data", (data) => {
    const match = data.toString().match(/(\d+\.?\d*)%/);
    if (match) job.progress = parseFloat(match[1]);
  });

  proc.stderr.on("data", (data) => console.error("yt-dlp stderr:", data.toString()));

  proc.on("close", (code) => {
    if (code === 0) {
      const files = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.startsWith(jobId));
      if (files.length > 0) {
        job.filename = files[0];
        job.status = "done";
        job.progress = 100;
      } else {
        job.status = "error";
        job.error = "Output file not found";
      }
    } else {
      job.status = "error";
      job.error = "Download failed (exit code " + code + ")";
    }
  });
});

// GET /api/status/:jobId
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// GET /api/file/:jobId
app.get("/api/file/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done") return res.status(404).json({ error: "File not ready" });
  const filePath = path.join(DOWNLOADS_DIR, job.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });
  res.download(filePath, job.filename);
});

app.listen(PORT, () => console.log(`🎬 VideoLoad running on http://localhost:${PORT}`));
