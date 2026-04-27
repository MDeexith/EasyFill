import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

// ─── Types ──────────────────────────────────────────────────────────
interface Job {
  id: string;
  title: string;
  company: string;
  department: string;
  category: string;
  location: string;
  applyUrl: string;
  postedDate: string | null;
  source: 'greenhouse' | 'lever' | 'remotive' | 'arbeitnow';
  sourceLabel: string;
}

// ─── Curated company lists ──────────────────────────────────────────
const GREENHOUSE_COMPANIES = [
  'figma', 'stripe', 'notion', 'cloudflare', 'airtable',
  'databricks', 'discord', 'duolingo', 'gusto', 'hashicorp',
  'ironclad', 'lattice', 'linear', 'loom', 'miro',
  'plaid', 'ramp', 'retool', 'rippling', 'scale',
  'snyk', 'sourcegraph', 'supabase', 'vercel', 'watershed',
  'webflow', 'doordash', 'brex', 'dbt-labs', 'anduril',
];

const LEVER_COMPANIES = [
  'netflix', 'twitch', 'lever', 'postman', 'netlify',
  'samsara', 'verkada', 'anthropic', 'wiz-inc', 'lucidmotors',
  'navan', 'podium', 'earnin', 'hightouch', 'weights-and-biases',
];

let customCompanies: { handle: string; platform: 'greenhouse' | 'lever' }[] = [];

// ─── Cache ──────────────────────────────────────────────────────────
interface CacheEntry {
  data: Job[];
  ts: number;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCached(key: string): Job[] | null {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: Job[]) {
  cache[key] = { data, ts: Date.now() };
}

// ─── Role categorization ────────────────────────────────────────────
function categorizeRole(title: string, dept: string): string {
  const t = `${title} ${dept}`.toLowerCase();
  if (/\b(engineer|developer|frontend|backend|fullstack|full-stack|devops|sre|infrastructure|platform|software|swe|mobile|ios|android|ml|machine learning|data engineer|cloud)\b/.test(t)) return 'Engineering';
  if (/\b(design|ux|ui|product design|graphic|visual|brand design|creative)\b/.test(t)) return 'Design';
  if (/\b(product manager|product lead|pm|product owner|product analyst)\b/.test(t)) return 'Product';
  if (/\b(market|growth|seo|content|social media|communications|pr|public relations|brand)\b/.test(t)) return 'Marketing';
  if (/\b(sales|account executive|business develop|bdr|sdr|revenue|partnerships)\b/.test(t)) return 'Sales';
  if (/\b(ops|operations|people|hr|human resources|recruiting|recruiter|talent|finance|accounting|legal|admin|office|facilities)\b/.test(t)) return 'Operations';
  if (/\b(data scien|analyst|analytics|bi |business intelligence|research)\b/.test(t)) return 'Data';
  if (/\b(support|success|customer|cx|helpdesk|technical support)\b/.test(t)) return 'Support';
  return 'Other';
}

// ─── Fetchers ───────────────────────────────────────────────────────

async function fetchGreenhouseJobs(boardToken: string): Promise<Job[]> {
  const cacheKey = `gh_${boardToken}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`,
      { timeout: 10000 }
    );
    const jobs: Job[] = (res.data.jobs || []).map((j: any) => {
      const dept = j.departments?.[0]?.name || '';
      const loc = j.location?.name || '';
      return {
        id: `gh_${boardToken}_${j.id}`,
        title: j.title || '',
        company: j.company?.name || boardToken,
        department: dept,
        category: categorizeRole(j.title || '', dept),
        location: loc,
        applyUrl: j.absolute_url || `https://boards.greenhouse.io/${boardToken}/jobs/${j.id}`,
        postedDate: j.updated_at || null,
        source: 'greenhouse' as const,
        sourceLabel: 'Greenhouse',
      };
    });
    setCache(cacheKey, jobs);
    return jobs;
  } catch {
    return [];
  }
}

async function fetchLeverJobs(companyHandle: string): Promise<Job[]> {
  const cacheKey = `lv_${companyHandle}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(
      `https://api.lever.co/v0/postings/${companyHandle}?mode=json`,
      { timeout: 10000 }
    );
    const postings = Array.isArray(res.data) ? res.data : [];
    const jobs: Job[] = postings.map((p: any) => {
      const dept = p.categories?.team || p.categories?.department || '';
      const loc = p.categories?.location || '';
      const commitment = p.categories?.commitment || '';
      return {
        id: `lv_${companyHandle}_${p.id}`,
        title: p.text || '',
        company: p.company || companyHandle,
        department: dept,
        category: categorizeRole(p.text || '', dept),
        location: loc + (commitment ? ` · ${commitment}` : ''),
        applyUrl: p.hostedUrl || p.applyUrl || '',
        postedDate: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        source: 'lever' as const,
        sourceLabel: 'Lever',
      };
    });
    setCache(cacheKey, jobs);
    return jobs;
  } catch {
    return [];
  }
}

async function fetchRemotiveJobs(search?: string, category?: string): Promise<Job[]> {
  const cacheKey = `remotive_${search || ''}_${category || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const params: Record<string, string> = { limit: '100' };
    if (search) params.search = search;
    if (category) {
      // Map our categories to Remotive's category slugs
      const catMap: Record<string, string> = {
        'Engineering': 'software-dev',
        'Design': 'design',
        'Product': 'product',
        'Marketing': 'marketing',
        'Sales': 'sales',
        'Data': 'data',
        'Support': 'customer-support',
        'Operations': 'hr',
      };
      if (catMap[category]) params.category = catMap[category];
    }
    const res = await axios.get('https://remotive.com/api/remote-jobs', {
      params,
      timeout: 15000,
    });
    const jobs: Job[] = (res.data.jobs || []).map((j: any) => ({
      id: `rem_${j.id}`,
      title: j.title || '',
      company: j.company_name || '',
      department: j.category || '',
      category: categorizeRole(j.title || '', j.category || ''),
      location: j.candidate_required_location || 'Remote',
      applyUrl: j.url || '',
      postedDate: j.publication_date || null,
      source: 'remotive' as const,
      sourceLabel: 'Remotive',
    }));
    setCache(cacheKey, jobs);
    return jobs;
  } catch {
    return [];
  }
}

async function fetchArbeitnowJobs(page: number = 1): Promise<Job[]> {
  const cacheKey = `arb_p${page}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get('https://www.arbeitnow.com/api/job-board-api', {
      params: { page },
      timeout: 15000,
    });
    const jobs: Job[] = (res.data.data || []).map((j: any) => ({
      id: `arb_${j.slug || j.url || Math.random().toString(36).slice(2)}`,
      title: j.title || '',
      company: j.company_name || '',
      department: j.tags?.join(', ') || '',
      category: categorizeRole(j.title || '', (j.tags || []).join(' ')),
      location: j.location || (j.remote ? 'Remote' : ''),
      applyUrl: j.url || '',
      postedDate: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
      source: 'arbeitnow' as const,
      sourceLabel: 'Arbeitnow',
    }));
    setCache(cacheKey, jobs);
    return jobs;
  } catch {
    return [];
  }
}

// ─── Routes ─────────────────────────────────────────────────────────

// GET /jobs/feed
router.get('/feed', async (req: Request, res: Response) => {
  const search = (req.query.search as string || '').toLowerCase().trim();
  const category = req.query.category as string || '';
  const page = parseInt(req.query.page as string) || 1;
  const sourcesParam = req.query.sources as string || '';
  const enabledSources = sourcesParam
    ? sourcesParam.split(',').map(s => s.trim().toLowerCase())
    : ['greenhouse', 'lever', 'remotive', 'arbeitnow'];

  const promises: Promise<Job[]>[] = [];

  // Greenhouse
  if (enabledSources.includes('greenhouse')) {
    const companies = [
      ...GREENHOUSE_COMPANIES,
      ...customCompanies.filter(c => c.platform === 'greenhouse').map(c => c.handle),
    ];
    // Fetch in batches of 10 to not overwhelm
    const batch = companies.slice(0, 15);
    for (const co of batch) {
      promises.push(fetchGreenhouseJobs(co));
    }
  }

  // Lever
  if (enabledSources.includes('lever')) {
    const companies = [
      ...LEVER_COMPANIES,
      ...customCompanies.filter(c => c.platform === 'lever').map(c => c.handle),
    ];
    for (const co of companies) {
      promises.push(fetchLeverJobs(co));
    }
  }

  // Remotive
  if (enabledSources.includes('remotive')) {
    promises.push(fetchRemotiveJobs(search || undefined, category || undefined));
  }

  // Arbeitnow
  if (enabledSources.includes('arbeitnow')) {
    promises.push(fetchArbeitnowJobs(page));
  }

  // Fetch all in parallel
  const results = await Promise.allSettled(promises);
  let allJobs: Job[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allJobs = allJobs.concat(r.value);
    }
  }

  // Apply search filter
  if (search) {
    allJobs = allJobs.filter(j =>
      j.title.toLowerCase().includes(search) ||
      j.company.toLowerCase().includes(search) ||
      j.department.toLowerCase().includes(search) ||
      j.location.toLowerCase().includes(search)
    );
  }

  // Apply category filter
  if (category && category !== 'All') {
    allJobs = allJobs.filter(j => j.category === category);
  }

  // Sort by posted date (newest first) — jobs without dates go last
  allJobs.sort((a, b) => {
    const da = a.postedDate ? new Date(a.postedDate).getTime() : 0;
    const db = b.postedDate ? new Date(b.postedDate).getTime() : 0;
    return db - da;
  });

  // Paginate
  const perPage = 50;
  const start = (page - 1) * perPage;
  const paginated = allJobs.slice(start, start + perPage);

  res.json({
    jobs: paginated,
    total: allJobs.length,
    page,
    perPage,
    hasMore: start + perPage < allJobs.length,
  });
});

// GET /jobs/companies — return tracked companies
router.get('/companies', (_req: Request, res: Response) => {
  res.json({
    greenhouse: [
      ...GREENHOUSE_COMPANIES,
      ...customCompanies.filter(c => c.platform === 'greenhouse').map(c => c.handle),
    ],
    lever: [
      ...LEVER_COMPANIES,
      ...customCompanies.filter(c => c.platform === 'lever').map(c => c.handle),
    ],
  });
});

// POST /jobs/companies — add a custom company
router.post('/companies', (req: Request, res: Response) => {
  const { handle, platform } = req.body;
  if (!handle || !platform || !['greenhouse', 'lever'].includes(platform)) {
    res.status(400).json({ error: 'handle and platform (greenhouse|lever) are required' });
    return;
  }
  const exists = customCompanies.some(c => c.handle === handle && c.platform === platform);
  if (!exists) {
    customCompanies.push({ handle, platform });
  }
  res.json({ ok: true });
});

export default router;
