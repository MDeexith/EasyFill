import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { generate } from '../ollama';

const router = Router();

const BodySchema = z.object({
  profile: z.record(z.string(), z.unknown()),
  label: z.string().optional().default(''),
  placeholder: z.string().optional().default(''),
  nearby: z.string().optional().default(''),
  host: z.string().optional().default(''),
});

const promptTemplate = fs.readFileSync(
  path.join(__dirname, '../../prompts/generate.txt'),
  'utf-8'
);

function formatProfile(profile: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(profile)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    const valueStr = typeof v === 'string' ? v : JSON.stringify(v);
    if (valueStr.length > 400) continue;
    lines.push(`- ${k}: ${valueStr}`);
  }
  return lines.join('\n');
}

router.post('/', async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { profile, label, placeholder, nearby, host } = parsed.data;
  const prompt = promptTemplate
    .replace('{{PROFILE}}', formatProfile(profile))
    .replace('{{LABEL}}', label || '(none)')
    .replace('{{PLACEHOLDER}}', placeholder || '(none)')
    .replace('{{NEARBY}}', nearby || '(none)')
    .replace('{{HOST}}', host || '(unknown)');

  try {
    const raw = await generate(prompt);
    const text = raw
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    res.json({ text });
  } catch (err) {
    console.error('generate error:', err);
    res.status(500).json({ error: 'LLM call failed' });
  }
});

export default router;
