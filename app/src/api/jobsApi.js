import axios from 'axios';
import { getBackendUrl } from './backend';
import { buildProfileSearchAttempts } from '../jobs/profileFeed';

/**
 * Fetch job listings from the backend aggregation API.
 * @param {Object} opts
 * @param {string} [opts.search] - Search query
 * @param {string} [opts.category] - Role category filter
 * @param {number} [opts.page] - Page number (default 1)
 * @param {string[]} [opts.sources] - Array of sources to include
 * @returns {{ jobs, total, page, perPage, hasMore }}
 */
export async function fetchJobFeed({ search, category, location, page = 1, sources, isRemote } = {}) {
  const params = { page };
  if (search) params.search = search;
  if (category && category !== 'All') params.category = category;
  if (location) params.location = location;
  if (sources && sources.length > 0) params.sources = sources.join(',');
  if (isRemote) params.is_remote = true;

  const res = await axios.get(`${getBackendUrl()}/jobs/feed`, {
    params,
    timeout: 30000,
  });
  return res.data;
}

/**
 * Fetch jobs using profile currentTitle with shortened-title retries, then generic feed.
 * @param {Object} rawProfile - User profile from MMKV
 * @param {Object} [feedOpts] - Same options as fetchJobFeed (page, category, location, etc.)
 * @returns {Promise<{ result: object, searchUsed: string|null, fromProfile: boolean }>}
 */
export async function fetchJobFeedForProfile(rawProfile, feedOpts = {}) {
  const attempts = buildProfileSearchAttempts(rawProfile);

  for (const query of attempts) {
    const result = await fetchJobFeed({ ...feedOpts, search: query });
    if (result.total > 0) {
      return { result, searchUsed: query, fromProfile: true };
    }
  }

  const result = await fetchJobFeed(feedOpts);
  return { result, searchUsed: null, fromProfile: false };
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
