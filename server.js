// import var from "package";

import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import pdfParse from "pdf-parse";
// import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";
import {GoogleGenerativeAI} from "@google/generative-ai";


//  Function to extract text from images using Tesseract
async function extractTextFromImage(imageBuffer) {
  try {
    console.log(" Attempting OCR extraction...");
    
    //  Updated Tesseract.js API (Feb 2026)
    const result = await Tesseract.recognize(
      imageBuffer,
      'eng',
      {
        logger: m => console.log(m) // Optional: see progress
      }
    );
    
    return result.data.text;
  } catch (error) {
    console.error(" OCR Error:", error.message);
    return "";
  }
}


dotenv.config();
const PORT = process.env.PORT;



//  Gemini setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//  Helper: Ask Gemini and force JSON output
async function askGeminiForJSON(prompt) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const jsonOnlyPrompt = `
You are an API. Return ONLY valid JSON.
No markdown. No backticks. No extra explanation.

${prompt}
`;

  const result = await model.generateContent(jsonOnlyPrompt);
  const raw = result.response.text();

  //  Try JSON.parse directly
  try {
    return JSON.parse(raw);
  } catch {
    //  Fallback: extract JSON block if Gemini adds extra text
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("Gemini did not return JSON.");
    const cleaned = raw.slice(first, last + 1);
    return JSON.parse(cleaned);
  }
}

const server = express()

const upload = multer({ storage: multer.memoryStorage() });

server.use(
    express.static('public'),
    express.json()
)

server.get("/", function(req, res){
    res.json({message: "this message is from server"})
})

server.post("/resume/upload", upload.single("resume"), async function(req, res){

    // if(!req.file){
    //     res.status(400).json({error: "File not uploaded"})
    // }

    // let resumeText = await pdfParse(req.file.buffer).text?.trim() || ""

    // if(resumeText.length<50){
    //     resumeText = await extractTextFromImage(req.file.buffer);
    // }

    // if(resumeText.length<50){
    //     res.status(400).json({error: "PDF reading failed."})
    // }



    const targetRole = req.body.targetRole || "Software Developer (Fresher)";

    //  3) Extract text from PDF

    console.log("Extracting text from PDF...");
    let resumeText = "";
    
    try {
      //  Fixed: correct pdf-parse usage
      const pdfData = await pdfParse(req.file.buffer);
      resumeText = (pdfData.text || "").trim();
      console.log(` Extracted ${resumeText.length} characters from PDF`);
    } catch (pdfError) {
      console.error(" PDF extraction failed:", pdfError.message);
    }

    //  4) If PDF text extraction failed, try OCR
    if (!resumeText) {
      console.log(" PDF text is empty. Attempting OCR...");
      
      try {
        resumeText = await extractTextFromImage(req.file.buffer);
        
        if (!resumeText || resumeText.trim().length === 0) {
          return res.status(400).json({
            error: "Could not extract text from PDF. The file might be an image-based PDF without text layer, or the OCR failed. Please try a text-based PDF.",
          });
        }
        
        console.log(` OCR extracted ${resumeText.length} characters`);
      } catch (ocrError) {
        return res.status(400).json({
          error: "Could not extract text from PDF using OCR. Error: " + ocrError.message,
        });
      }
    }

    //  Final check
    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({
        error: "Extracted text is too short or empty. Please upload a valid resume PDF.",
      });
    }

    //  5) Ask Gemini to analyze resume
    console.log(" Sending to Gemini for analysis...");
        //  5) Ask Gemini to analyze resume
    console.log(" Sending to Gemini for analysis...");
    
    const prompt = `
Analyze this resume for the target role: "${targetRole}"

Return JSON in EXACT shape:
{
  "atsScore": number (0-100),
  "strengths": ["..."],
  "weakAreas": ["..."],
  "missingSkills": ["..."],
  "projectGaps": ["..."],
  "quickFixes": ["..."],
  "oneLineVerdict": "..."
}

Rules:
- Be beginner-friendly.
- Be realistic (no fake praise).
- Mention projects/deployment/GitHub if missing.

Resume Text:
"""
${resumeText}
"""
`;

    const analysis = await askGeminiForJSON(prompt);
    console.log(" Analysis complete!");

    //  6) Return response
    res.json({
      targetRole,
      fileName: req.file.originalname,
      extractedChars: resumeText.length,
      analysis,
    });
})


server.listen(PORT, function(){
    console.log("App is running at: "+PORT)
})