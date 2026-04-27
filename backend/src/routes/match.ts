import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { generate } from '../ollama';

const router = Router();

const FieldSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  ariaLabel: z.string().optional(),
  nearbyText: z.string().optional(),
});

const BodySchema = z.object({
  fields: z.array(FieldSchema),
  profile: z.record(z.string(), z.unknown()),
});

const promptTemplate = fs.readFileSync(
  path.join(__dirname, '../../prompts/match.txt'),
  'utf-8'
);

router.post('/', async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { fields, profile } = parsed.data;
  const profileKeys = Object.keys(profile).join(', ');
  const fieldsJson = JSON.stringify(fields);

  const prompt = promptTemplate
    .replace('{{FIELDS}}', fieldsJson)
    .replace('{{PROFILE_KEYS}}', profileKeys);

  try {
    const raw = await generate(prompt);
    // strip any markdown fences
    const jsonStr = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    const mapping = JSON.parse(jsonStr) as Record<string, string | null>;
    res.json({ mapping });
  } catch (err) {
    console.error('match error:', err);
    res.status(500).json({ error: 'LLM call failed' });
  }
});

export default router;
