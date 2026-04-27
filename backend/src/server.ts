import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import matchRouter from './routes/match';
import parseResumeRouter from './routes/parseResume';
import generateRouter from './routes/generate';
import jobsRouter from './routes/jobs';

const app = express();
const PORT = process.env.PORT || 3001;

const upload = multer({ dest: path.join(__dirname, '../uploads/') });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/match', matchRouter);
app.use('/parse-resume', upload.single('file'), parseResumeRouter);
app.use('/generate', generateRouter);
app.use('/jobs', jobsRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

export default app;
