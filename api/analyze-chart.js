// api/analyze-chart.js (fundamental)
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
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" }); 

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

    const assetType = fields.assetType ? fields.assetType[0] : '';
    const timeframe = fields.timeframe ? fields.timeframe[0] : '';
    const additionalNotes = fields.additionalNotes ? fields.additionalNotes[0] : '';
    const outputLanguage = fields.outputLanguage ? fields.outputLanguage[0] : 'en'; // Dapatkan bahasa output dari frontend

    // Tentukan bahasa untuk instruksi prompt ke AI
    const languagePrompt = outputLanguage === 'id' ? 
        "Berikan jawaban dalam Bahasa Indonesia." : 
        "Provide the answer in English.";

    // Instruksi prompt yang lebih spesifik untuk AI
    const parts = [
      imagePart,
      { text: `This fundamental prediction. ` },
      { text: `It's for ${assetType} asset.` },
      { text: `Provide a clear prediction of the market's likely direction (e.g., Good, Bad, Neutral) and a brief rationale.` },
    ];

    if (additionalNotes) {
        parts.push({ text: `Additional context from user: "${additionalNotes}". Incorporate this into your analysis if relevant.` });
    }

    parts.push({ text: `Focus on the fundamentals that will be predicted and focus on providing predictions on where the price will move when the data is published and what steps are the safest to take to avoid being liquidated. Please provide a complete and detailed prediction of the market price position. Provide output in this structured JSON-like format: { "direction": "string", "rationale": "string", "support": "string", "resistance": "string", "riskWarning": "string" }. ${languagePrompt}` });


    const result = await model.generateContent({
        contents: [{ role: "user", parts: parts }],
    });

    const geminiResponseText = result.response.text();
    console.log("Gemini Raw Response:", geminiResponseText);

    let analysisOutput;
    try {
        const jsonMatch = geminiResponseText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            analysisOutput = JSON.parse(jsonMatch[1]);
        } else {
            analysisOutput = JSON.parse(geminiResponseText);
        }
    } catch (parseError) {
        console.error("Failed to parse Gemini's JSON response, sending fallback text:", parseError);
        // Fallback messages based on requested language
        const fallbackMessage = outputLanguage === 'id' ? 
            "Gagal mem-parse analisis rinci dari AI. Respon mentah: " : 
            "Failed to parse detailed analysis from AI. Raw response: ";
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
    // Tambahkan pesan error yang bisa disesuaikan bahasa di frontend
    const errorMessage = request.headers['accept-language'] && request.headers['accept-language'].includes('id') ? 
        `Gagal menganalisis grafik. Detail kesalahan: ${error.message}` : 
        `Failed to analyze chart. Error details: ${error.message}`;

    response.status(500).json({ message: errorMessage });
  }
}
