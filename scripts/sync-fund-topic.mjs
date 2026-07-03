import { readFile } from 'node:fs/promises';
import path from 'node:path';
import lodash from 'lodash';

const { isArray } = lodash;

const loadLocalEnv = async () => {
  const envPath = path.join(process.cwd(), '.env.local');
  try {
    const content = await readFile(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // .env.local is optional.
  }
};

await loadLocalEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.log('Skip fund_topic sync: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  process.exit(0);
}

const commonHeaders = {
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, retries = 3) => {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: commonHeaders });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      await sleep(500 + attempt * 700);
    }
  }

  throw lastError || new Error('Request failed');
};

const normalizeSectorRows = (rows, sectorType) => {
  if (!isArray(rows)) return [];
  const now = new Date().toISOString();
  return rows
    .map((item) => ({
      update_at: now,
      sector_type: sectorType,
      sector_id: item.f12 != null ? String(item.f12) : '',
      sector_name: item.f14 != null ? String(item.f14) : '',
      update_frequency: '15m',
      net_inflow: item.f62 != null && Number.isFinite(Number(item.f62)) ? Math.round(Number(item.f62)) : 0,
      change_pct: item.f3 != null && Number.isFinite(Number(item.f3)) ? Number(item.f3) : 0
    }))
    .filter((item) => item.sector_id && item.sector_name);
};

const fetchSectorPage = async (typeCode, sectorType, page = 1) => {
  const params = new URLSearchParams({
    pn: String(page),
    pz: '100',
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: `m:90+t:${typeCode}`,
    fields: 'f12,f14,f3,f62'
  });
  const payload = await fetchJson(`https://push2delay.eastmoney.com/api/qt/clist/get?${params.toString()}`);
  const rows = payload?.data?.diff;
  const total = payload?.data?.total != null && Number.isFinite(Number(payload.data.total)) ? Number(payload.data.total) : 0;
  return { rows: normalizeSectorRows(rows, sectorType), total };
};

const fetchSectorList = async (typeCode, sectorType) => {
  const firstPage = await fetchSectorPage(typeCode, sectorType, 1);
  const totalPages = Math.min(8, Math.max(1, Math.ceil((firstPage.total || firstPage.rows.length) / 100)));
  if (totalPages <= 1) return firstPage.rows;

  const restPages = [];
  for (let page = 2; page <= totalPages; page += 1) {
    restPages.push(await fetchSectorPage(typeCode, sectorType, page).catch(() => ({ rows: [], total: 0 })));
    await sleep(120);
  }

  const map = new Map();
  for (const item of [...firstPage.rows, ...restPages.flatMap((page) => page.rows)]) {
    if (item.sector_id) map.set(item.sector_id, item);
  }
  return Array.from(map.values());
};

const upsertRows = async (rows) => {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/fund_topic?on_conflict=sector_id`;
  let updated = 0;

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(chunk)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Upsert fund_topic failed: ${response.status} ${body}`);
    }
    updated += chunk.length;
  }

  return updated;
};

const [industries, concepts] = await Promise.all([fetchSectorList(2, 'industry'), fetchSectorList(3, 'concept')]);
const rows = [...industries, ...concepts];
const updated = await upsertRows(rows);

console.log(`Synced fund_topic: ${updated} rows (${industries.length} industry, ${concepts.length} concept)`);
