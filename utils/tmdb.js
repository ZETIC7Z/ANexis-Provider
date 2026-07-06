const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { config } = require('./config');

const cache = {
  imdbByTmdb: new Map(),
  details: new Map(),
};
const TTL_MS = 6 * 60 * 60 * 1000;
function isFresh(entry) { return entry && (Date.now() - entry.ts) < TTL_MS; }

async function tmdbFetchJson(url) {
  const apiKey = config.tmdbApiKey || (config.tmdbApiKeys && config.tmdbApiKeys[0]) || null;
  if (!apiKey) throw new Error('TMDB_API_KEY missing');
  const sep = url.includes('?') ? '&' : '?';
  const full = `${url}${sep}api_key=${apiKey}`;
  const res = await fetch(full, { timeout: 15000 });
  if (!res.ok) throw new Error(`TMDB request failed ${res.status}`);
  return res.json();
}
async function getExternalIds(type, tmdbId) {
  const key = `${type}:${tmdbId}`;
  const cached = cache.imdbByTmdb.get(key);
  if (isFresh(cached)) return await cached.promise;
  
  const promise = tmdbFetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids`);
  cache.imdbByTmdb.set(key, { promise, ts: Date.now() });
  return await promise;
}
async function getDetails(type, tmdbId) {
  const key = `${type}:${tmdbId}:details`;
  const cached = cache.details.get(key);
  if (isFresh(cached)) return await cached.promise;
  
  const promise = tmdbFetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}`);
  cache.details.set(key, { promise, ts: Date.now() });
  return await promise;
}

async function getSeasonDetails(tmdbId, seasonNum) {
  const key = `tv:${tmdbId}:season:${seasonNum}`;
  const cached = cache.details.get(key);
  if (isFresh(cached)) return await cached.promise;
  
  const promise = tmdbFetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}`);
  cache.details.set(key, { promise, ts: Date.now() });
  return await promise;
}

async function resolveImdbId(type, tmdbId) {
  try { const ext = await getExternalIds(type, tmdbId); return ext.imdb_id || null; } catch { return null; }
}
module.exports = { getExternalIds, getDetails, getSeasonDetails, resolveImdbId };