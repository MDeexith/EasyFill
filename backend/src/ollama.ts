import axios from 'axios';

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'gemma3:4b';
const TIMEOUT = 60000;

interface OllamaResponse {
  response: string;
}

export async function generate(prompt: string): Promise<string> {
  const res = await axios.post<OllamaResponse>(
    `${OLLAMA_BASE}/api/generate`,
    { model: MODEL, prompt, stream: false, options: { temperature: 0 } },
    { timeout: TIMEOUT }
  );
  return res.data.response.trim();
}

export async function generateWithImage(prompt: string, imageBase64: string): Promise<string> {
  const res = await axios.post<OllamaResponse>(
    `${OLLAMA_BASE}/api/generate`,
    {
      model: MODEL,
      prompt,
      images: [imageBase64],
      stream: false,
      options: { temperature: 0 },
    },
    { timeout: TIMEOUT }
  );
  return res.data.response.trim();
}
