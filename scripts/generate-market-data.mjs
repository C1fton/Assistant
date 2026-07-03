import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import lodash from 'lodash';

const { isArray, isObject } = lodash;

const OUTPUT_FILE = path.join(process.cwd(), 'public', 'data', 'market-data.json');

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
    // .env.local is optional in CI and local clones.
  }
};

await loadLocalEnv();

const commonHeaders = {
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://fund.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const rankingKey = ({ sort, order, page, pageSize }) => `${sort}:${order}:${page}:${pageSize}`;
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

const fetchRanking = async ({ sort, order, page, pageSize }) => {
  const params = new URLSearchParams({
    type: '1',
    sort: String(sort),
    orderType: order,
    canbuy: '0',
    pageIndex: String(page),
    pageSize: String(pageSize)
  });
  const payload = await fetchJson(`https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList?${params.toString()}`);
  if (payload?.ErrCode !== 0 || !isObject(payload?.Data)) {
    throw new Error(`Invalid ranking payload: ${payload?.ErrCode ?? 'unknown'}`);
  }
  return payload;
};

const fetchSectorList = async (typeCode, sectorType) => {
  const params = new URLSearchParams({
    pn: '1',
    pz: '500',
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
  if (!isArray(rows)) return [];

  return rows.map((item) => ({
    id: `${sectorType}-${item.f12}`,
    sector_id: item.f12 != null ? String(item.f12) : '',
    sector_name: item.f14 != null ? String(item.f14) : '',
    sector_type: sectorType,
    change_pct: item.f3 != null && Number.isFinite(Number(item.f3)) ? Number(item.f3) : 0,
    net_inflow: item.f62 != null && Number.isFinite(Number(item.f62)) ? Number(item.f62) : 0
  }));
};

const fetchFundTopicFromSupabase = async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/fund_topic?select=*`, {
      headers: {
        Accept: 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    if (!response.ok) return [];
    const rows = await response.json();
    if (!isArray(rows)) return [];
    return rows
      .map((item) => ({
        id: item?.id != null ? String(item.id) : `${item?.sector_type || 'sector'}-${item?.sector_id || item?.sector_name}`,
        sector_id: item?.sector_id != null ? String(item.sector_id) : '',
        sector_name: item?.sector_name != null ? String(item.sector_name) : '',
        sector_type: item?.sector_type != null ? String(item.sector_type) : '',
        change_pct: item?.change_pct != null && Number.isFinite(Number(item.change_pct)) ? Number(item.change_pct) : 0,
        net_inflow: item?.net_inflow != null && Number.isFinite(Number(item.net_inflow)) ? Number(item.net_inflow) : 0
      }))
      .filter((item) => item.sector_name);
  } catch {
    return [];
  }
};

const rankingRequests = [];
const rankingTabs = [
  { sort: 3, order: 'desc' },
  { sort: 3, order: 'asc' },
  { sort: 4, order: 'desc' },
  { sort: 5, order: 'desc' }
];

for (const tab of rankingTabs) {
  for (let page = 1; page <= 5; page += 1) {
    rankingRequests.push({ ...tab, page, pageSize: 20 });
  }
}

const rankings = {};
const rankingResults = [];

for (const request of rankingRequests) {
  const result = await Promise.resolve()
    .then(async () => {
    const data = await fetchRanking(request);
    rankings[rankingKey(request)] = data;
    })
    .then(
      () => ({ status: 'fulfilled' }),
      (reason) => ({ status: 'rejected', reason })
    );
  rankingResults.push(result);
  await sleep(250);
}

const supabaseSectors = await fetchFundTopicFromSupabase();
const [industryResult, conceptResult] =
  supabaseSectors.length > 0
    ? [{ status: 'fulfilled', value: [] }, { status: 'fulfilled', value: [] }]
    : await Promise.allSettled([fetchSectorList(2, 'industry'), fetchSectorList(3, 'concept')]);

const sectors =
  supabaseSectors.length > 0
    ? supabaseSectors
    : [
        ...(industryResult.status === 'fulfilled' ? industryResult.value : []),
        ...(conceptResult.status === 'fulfilled' ? conceptResult.value : [])
      ];

const output = {
  generatedAt: new Date().toISOString(),
  rankings,
  sectors,
  errors: {
    rankings: rankingResults.filter((result) => result.status === 'rejected').length,
    sectors: [industryResult, conceptResult].filter((result) => result.status === 'rejected').length
  }
};

await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, `${JSON.stringify(output)}\n`, 'utf8');

console.log(
  `Generated market data: ${Object.keys(rankings).length}/${rankingRequests.length} rankings, ${sectors.length} sectors (${supabaseSectors.length > 0 ? 'supabase fund_topic' : 'eastmoney fallback'})`
);
