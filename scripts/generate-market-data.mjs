import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import lodash from 'lodash';

const { isArray, isObject } = lodash;

const OUTPUT_FILE = path.join(process.cwd(), 'public', 'data', 'market-data.json');

const commonHeaders = {
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://fund.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const rankingKey = ({ sort, order, page, pageSize }) => `${sort}:${order}:${page}:${pageSize}`;

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: commonHeaders });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
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
const rankingResults = await Promise.allSettled(
  rankingRequests.map(async (request) => {
    const data = await fetchRanking(request);
    rankings[rankingKey(request)] = data;
  })
);

const [industryResult, conceptResult] = await Promise.allSettled([
  fetchSectorList(2, 'industry'),
  fetchSectorList(3, 'concept')
]);

const sectors = [
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
  `Generated market data: ${Object.keys(rankings).length}/${rankingRequests.length} rankings, ${sectors.length} sectors`
);
