// api/analyze-chart.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import fs from 'fs/promises';

// Fungsi helper untuk mengonversi buffer gambar ke format yang dapat diterima Gemini
function fileToGenerativePart(fileBuffer, mimeType) {
  return {
    inlineData: {
      data: fileBuffer.toString('base64'),
      mimeType
    },
  };
}

export const config = {
  api: {
    bodyParser: false, // Penting! Nonaktifkan bodyParser agar kita bisa memproses multipart/form-data secara manual
  },
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ message: 'Server is full, please try again later.' });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Menggunakan model yang lebih kuat seperti yang diminta untuk analisis kompleks
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" }); 

  try {
    const form = formidable({});
    const [fields, files] = await form.parse(request);

    if (!files.image || files.image.length === 0) {
      return response.status(400).json({ message: 'No image file uploaded.' });
    }

    const imageFile = files.image[0];
    if (!imageFile.mimetype.startsWith('image/')) {
        return response.status(400).json({ message: 'Invalid file type. Please upload an image.' });
    }

    const imageBuffer = await fs.readFile(imageFile.filepath);
    const imagePart = fileToGenerativePart(imageBuffer, imageFile.mimetype);

    const assetType = fields.assetType ? fields.assetType[0] : 'this asset';
    const timeframe = fields.timeframe ? fields.timeframe[0] : 'this timeframe';
    const additionalNotes = fields.additionalNotes ? fields.additionalNotes[0] : '';
    const outputLanguage = fields.outputLanguage ? fields.outputLanguage[0] : 'en';

    const languagePrompt = outputLanguage === 'id' ? 
        "Berikan semua teks dalam output JSON dalam Bahasa Indonesia." : 
        "Provide all text in the JSON output in English.";

    // --- PROMPT BARU YANG DIINTEGRASIKAN ---
    const detailedPrompt = `
      **ROLE & GOAL:** You are a Senior Financial Market Analyst AI. Your goal is to perform a comprehensive market analysis of the provided chart image and output a structured, actionable conclusion in JSON format.

      **MARKET DATA:**
      * **Asset:** ${assetType}
      * **Timeframe:** ${timeframe}
      * **User's Additional Context (News, Geopolitics, etc.):** "${additionalNotes}"

      **ANALYSIS INSTRUCTIONS (Perform these steps internally before concluding):**
      1.  **Market Character:** Briefly consider the typical volatility and drivers for ${assetType}.
      2.  **Comprehensive Technical Analysis:**
          * **Market Structure & Trend:** Identify the primary trend (Uptrend, Downtrend, Sideways) by analyzing swing highs and lows.
          * **Key Levels:** Pinpoint the most critical Support and Resistance levels. Identify any clear Supply/Demand zones or Fair Value Gaps (FVG).
          * **Chart Patterns:** Look for major chart patterns (e.g., Head and Shoulders, Triangles, Double Tops/Bottoms).
          * **Candlestick Patterns:** Identify influential recent candlestick patterns (e.g., Engulfing, Hammer, Doji) near key levels.
      3.  **Fundamental/Contextual Analysis:** Integrate the user's additional context. How does this news or geopolitical situation likely impact the sentiment for this asset?
      4.  **Synthesis:** Combine technical and fundamental findings. Are they in confluence or divergence? Formulate the most probable market direction. Identify a potential safe price for execution based on your analysis.

      **OUTPUT REQUIREMENT:**
      After performing the full analysis, you MUST format your final conclusion into a single, clean JSON object. Do not include any text or markdown before or after the JSON object.

      **JSON STRUCTURE:**
      {
        "direction": "Provide one word: 'Bullish', 'Bearish', or 'Sideways/Neutral'.",
        "rationale": "Provide a concise but comprehensive rationale for your direction. Mention the strongest technical and fundamental factors from your analysis (e.g., 'A bearish engulfing candle at a major resistance level, combined with negative inflation data, suggests a high probability of a downward move.'). Also, mention a potential safe price for execution.",
        "support": "State the most immediate and significant support level as a price or price range.",
        "resistance": "State the most immediate and significant resistance level as a price or price range.",
        "riskWarning": "Provide a standard risk warning about market volatility and the nature of analysis as non-financial advice."
      }

      ${languagePrompt}
    `;

    const parts = [
      imagePart,
      { text: detailedPrompt },
    ];

    const result = await model.generateContent({
        contents: [{ role: "user", parts: parts }],
        // Menambahkan instruksi agar output hanya berupa JSON
        generationConfig: {
          responseMimeType: "application/json",
        },
    });

    const geminiResponseText = result.response.text();
    console.log("Gemini Raw JSON Response:", geminiResponseText);

    let analysisOutput;
    try {
        // Karena kita meminta JSON, kita bisa langsung parse
        analysisOutput = JSON.parse(geminiResponseText);
    } catch (parseError) {
        console.error("Failed to parse Gemini's JSON response, sending fallback text:", parseError);
        const fallbackMessage = outputLanguage === 'id' ? 
            "Gagal mem-parse analisis dari AI. Respon mentah: " : 
            "Failed to parse analysis from AI. Raw response: ";
        const fallbackRiskWarning = outputLanguage === 'id' ?
            "Selalu berhati-hati. Analisis AI hanya untuk tujuan informasi." :
            "Always exercise caution. AI analysis is for informational purposes only.";

        analysisOutput = {
            direction: outputLanguage === 'id' ? "Tidak Pasti" : "Uncertain",
            rationale: fallbackMessage + geminiResponseText,
            support: "N/A",
            resistance: "N/A",
            riskWarning: fallbackRiskWarning
        };
    }
    
    response.status(200).json({ analysis: analysisOutput });

  } catch (error) {
    console.error('Error in analyze-chart API:', error);
    const errorMessage = request.headers['accept-language'] && request.headers['accept-language'].includes('id') ? 
        `Gagal menganalisis grafik. Detail kesalahan: ${error.message}` : 
        `Failed to analyze chart. Error details: ${error.message}`;

    response.status(500).json({ message: errorMessage });
  }
}