import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { generateWithImage } from '../ollama';

const router = Router();

const promptTemplate = fs.readFileSync(
  path.join(__dirname, '../../prompts/parseResume.txt'),
  'utf-8'
);

router.post('/', async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const filePath = req.file.path;

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString('base64');

    // For multimodal: send PDF first page as image via base64
    // Gemma 3 4B handles PDF bytes directly in Ollama's multimodal mode
    const prompt = promptTemplate.replace('{{RESUME_TEXT}}', '[See attached document]');

    const raw = await generateWithImage(prompt, base64);
    const jsonStr = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    const profile = JSON.parse(jsonStr);
    res.json({ profile });
  } catch (err) {
    console.error('parse-resume error:', err);
    res.status(500).json({ error: 'Resume parsing failed' });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

export default router;
