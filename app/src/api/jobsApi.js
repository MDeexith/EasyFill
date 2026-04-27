import axios from 'axios';
import { getBackendUrl } from './backend';

/**
 * Fetch job listings from the backend aggregation API.
 * @param {Object} opts
 * @param {string} [opts.search] - Search query
 * @param {string} [opts.category] - Role category filter
 * @param {number} [opts.page] - Page number (default 1)
 * @param {string[]} [opts.sources] - Array of sources to include
 * @returns {{ jobs, total, page, perPage, hasMore }}
 */
export async function fetchJobFeed({ search, category, page = 1, sources } = {}) {
  const params = { page };
  if (search) params.search = search;
  if (category && category !== 'All') params.category = category;
  if (sources && sources.length > 0) params.sources = sources.join(',');

  const res = await axios.get(`${getBackendUrl()}/jobs/feed`, {
    params,
    timeout: 30000,
  });
  return res.data;
}

/**
 * Fetch the list of tracked companies (Greenhouse + Lever handles).
 */
export async function fetchCompanies() {
  const res = await axios.get(`${getBackendUrl()}/jobs/companies`, { timeout: 10000 });
  return res.data;
}

/**
 * Add a custom company handle.
 * @param {string} handle - Company board token or handle
 * @param {'greenhouse' | 'lever'} platform
 */
export async function addCompany(handle, platform) {
  const res = await axios.post(`${getBackendUrl()}/jobs/companies`, {
    handle,
    platform,
  }, { timeout: 10000 });
  return res.data;
}
