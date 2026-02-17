import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

/* ===============================
   FIX FOR __dirname (ES MODULE)
================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===============================
   EXPRESS SETUP
================================ */
const app = express();
const PORT = process.env.PORT || 3000;   // 🔥 IMPORTANT FIX

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ===============================
   ROOT ROUTE
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ===============================
   FILE UPLOAD CONFIG
================================ */
const upload = multer({ storage: multer.memoryStorage() });

/* ===============================
   GEMINI SETUP
================================ */
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in environment variables");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* ===============================
   OCR FUNCTION
================================ */
async function extractTextFromImage(imageBuffer) {
  try {
    console.log("Attempting OCR extraction...");
    const result = await Tesseract.recognize(imageBuffer, "eng");
    return result.data.text;
  } catch (error) {
    console.error("OCR Error:", error.message);
    return "";
  }
}

/* ===============================
   GEMINI JSON HELPER
================================ */
async function askGeminiForJSON(prompt) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const jsonPrompt = `
You are an API. Return ONLY valid JSON.
No markdown. No backticks. No explanation.

${prompt}
`;

  const result = await model.generateContent(jsonPrompt);
  const raw = result.response.text();

  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) {
      throw new Error("Gemini did not return valid JSON.");
    }
    return JSON.parse(raw.slice(first, last + 1));
  }
}

/* ===============================
   RESUME UPLOAD ROUTE
================================ */
app.post("/resume/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const targetRole = req.body.targetRole || "Software Developer (Fresher)";

    console.log("Extracting text from PDF...");
    let resumeText = "";

    // Try PDF parse
    try {
      const pdfData = await pdfParse(req.file.buffer);
      resumeText = (pdfData.text || "").trim();
    } catch (err) {
      console.error("PDF extraction failed:", err.message);
    }

    // Try OCR if empty
    if (!resumeText) {
      resumeText = await extractTextFromImage(req.file.buffer);
    }

    if (!resumeText || resumeText.length < 50) {
      return res.status(400).json({
        error: "Could not extract sufficient text from resume.",
      });
    }

    console.log("Sending to Gemini...");

    const prompt = `
Analyze this resume for the role "${targetRole}".

Return JSON exactly like:
{
  "atsScore": number,
  "strengths": ["..."],
  "weakAreas": ["..."],
  "missingSkills": ["..."],
  "projectGaps": ["..."],
  "quickFixes": ["..."],
  "oneLineVerdict": "..."
}

Resume:
"""
${resumeText}
"""
`;

    const analysis = await askGeminiForJSON(prompt);

    res.json({
      targetRole,
      fileName: req.file.originalname,
      extractedChars: resumeText.length,
      analysis,
    });

  } catch (error) {
    console.error("Server Error:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
