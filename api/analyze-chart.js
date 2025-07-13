// api/analyze-chart.js
import { GoogleGenerativeAI } from '@google/generative-ai';

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
    return response.status(500).json({ message: 'GEMINI_API_KEY environment variable is not configured.' });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Menggunakan model 'gemini-1.5-flash-latest' atau 'gemini-1.5-pro-latest' untuk kemampuan Vision
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); 

  try {
    // Parsing multipart/form-data
    // Ini adalah bagian yang sedikit lebih kompleks karena Vercel defaultnya tidak memproses file upload.
    // Kita akan menggunakan 'formidable' atau sejenisnya jika ini di Node.js murni,
    // tapi untuk Vercel Serverless Function, kita bisa memanfaatkan 'busboy' atau memproses buffer langsung.
    // Namun, cara termudah adalah menggunakan helper dari framework seperti Next.js atau Hono jika ada,
    // atau untuk Vercel Native API, cukup akses request.body jika sudah dikonfigurasi untuk stream.
    // KARENA INI HTML/CSS/JS PURE, KITA AKAN ANGGAP request.body SUDAH BERUPA BUFFER DARI FILE UPLOAD
    // Atau yang lebih reliable adalah menggunakan 'formidable' sebagai dependensi.

    // Untuk kesederhanaan dan demonstrasi di lingkungan Vercel Serverless Function
    // yang menangani FormData dari browser:
    // Vercel seringkali sudah memiliki parsing bawaan untuk FormData jika bodyParser: false
    // Namun, kita perlu parse secara manual untuk mendapatkan field dan file.
    // Metode ini mungkin memerlukan library seperti 'busboy' atau 'multiparty' di real project.
    // Untuk demo sederhana, kita akan mengasumsikan FormData sudah di-parse oleh Vercel.
    // Jika tidak, Anda perlu menambahkan library parsing seperti 'formidable' dan menggunakannya.

    // Contoh manual parsing untuk Vercel (membutuhkan 'npm install busboy'):
    const busboy = require('busboy');
    const bb = busboy({ headers: request.headers });

    let fileBuffer;
    let mimeType;
    let assetType;
    let timeframe;
    let additionalNotes;

    const promises = [];

    bb.on('file', (name, file, info) => {
        const { filename, encoding, mimetype } = info;
        mimeType = mimetype;
        const fileChunks = [];
        file.on('data', chunk => fileChunks.push(chunk));
        file.on('end', () => {
            fileBuffer = Buffer.concat(fileChunks);
        });
    });

    bb.on('field', (name, val, info) => {
        if (name === 'assetType') assetType = val;
        else if (name === 'timeframe') timeframe = val;
        else if (name === 'additionalNotes') additionalNotes = val;
    });

    bb.on('finish', () => {
        promises.push(new Promise(resolve => resolve())); // Placeholder to ensure async completes
    });

    // Pipe the request stream to busboy
    // Note: In Vercel, `request` object might not be a raw stream by default.
    // You might need to wrap it if using Node.js's http.IncomingMessage.
    // For Vercel's native `request` object, `request.body` might be a stream.
    // A more robust solution might involve `data-uri` encoding on frontend
    // or using a library like `formidable`.

    // **Simplified approach for Vercel's `request` if `bodyParser: false` is set:**
    // Assuming 'request.body' is the raw stream/buffer.
    // A robust way to handle multipart/form-data in Vercel Serverless is complex without a framework helper.
    // For this example, let's use a common pattern with 'formidable' (install with `npm install formidable`).

    const formidable = require('formidable');
    const form = formidable({});

    const [fields, files] = await form.parse(request);

    if (!files.image || files.image.length === 0) {
      return response.status(400).json({ message: 'No image file uploaded.' });
    }

    const imageFile = files.image[0]; // Assuming single file upload
    if (!imageFile.mimetype.startsWith('image/')) {
        return response.status(400).json({ message: 'Invalid file type. Please upload an image.' });
    }

    const fs = require('fs/promises'); // Node.js built-in for file system operations
    const imageBuffer = await fs.readFile(imageFile.filepath);
    const imagePart = fileToGenerativePart(imageBuffer, imageFile.mimetype);

    assetType = fields.assetType ? fields.assetType[0] : '';
    timeframe = fields.timeframe ? fields.timeframe[0] : '';
    additionalNotes = fields.additionalNotes ? fields.additionalNotes[0] : '';

    const parts = [
      imagePart,
      { text: `Analyze this market chart. ` },
      { text: `It's for ${assetType} with a ${timeframe} timeframe.` },
      { text: `Provide a clear prediction of the market's likely direction (e.g., Bullish, Bearish, Sideways) and a brief rationale.` },
    ];

    if (additionalNotes) {
        parts.push({ text: `Additional context from user: "${additionalNotes}". Incorporate this into your analysis if relevant.` });
    }

    parts.push({ text: `Focus on key technical patterns, support/resistance levels, and overall trend. Please also include a short risk warning. Provide output in this structured JSON-like format: { "direction": "string", "rationale": "string", "support": "string", "resistance": "string", "riskWarning": "string" }` });


    const result = await model.generateContent({
        contents: [{ role: "user", parts: parts }],
    });

    const geminiResponseText = result.response.text();
    console.log("Gemini Raw Response:", geminiResponseText);

    // Try to parse the JSON output from Gemini
    let analysisOutput;
    try {
        // Gemini might wrap JSON in markdown code block, try to extract
        const jsonMatch = geminiResponseText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            analysisOutput = JSON.parse(jsonMatch[1]);
        } else {
            analysisOutput = JSON.parse(geminiResponseText); // Try parsing directly
        }
    } catch (parseError) {
        console.error("Failed to parse Gemini's JSON response, sending raw text:", parseError);
        analysisOutput = {
            direction: "Uncertain",
            rationale: "Could not parse detailed analysis from AI. Raw response: " + geminiResponseText,
            support: "N/A",
            resistance: "N/A",
            riskWarning: "Always exercise caution. AI analysis is for informational purposes only."
        };
    }
    
    response.status(200).json({ analysis: analysisOutput });

  } catch (error) {
    console.error('Error in analyze-chart API:', error);
    response.status(500).json({ message: 'Failed to analyze chart. Please check the image and try again. Error: ' + error.message });
  }
}
