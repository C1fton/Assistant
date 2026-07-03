import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SYNC_SECRET = Deno.env.get('SYNC_FUND_TOPIC_SECRET') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret'
};

type SectorType = 'industry' | 'concept';

const fetchMarketSectorList = async (typeCode: number, sectorType: SectorType) => {
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

  const response = await fetch(`https://push2delay.eastmoney.com/api/qt/clist/get?${params.toString()}`, {
    headers: {
      Referer: 'https://quote.eastmoney.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) throw new Error(`Eastmoney sector request failed: ${response.status}`);

  const payload = await response.json();
  const rows = Array.isArray(payload?.data?.diff) ? payload.data.diff : [];
  const now = new Date().toISOString();

  return rows
    .map((item: Record<string, unknown>) => ({
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

const upsertInChunks = async (supabase: ReturnType<typeof createClient>, rows: Record<string, unknown>[]) => {
  const chunkSize = 100;
  let updated = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('fund_topic').upsert(chunk, { onConflict: 'sector_id' });
    if (error) throw error;
    updated += chunk.length;
  }

  return updated;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY secret');
    }

    if (SYNC_SECRET) {
      const providedSecret =
        req.headers.get('x-sync-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
      if (providedSecret !== SYNC_SECRET) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const [industries, concepts] = await Promise.all([fetchMarketSectorList(2, 'industry'), fetchMarketSectorList(3, 'concept')]);
    const rows = [...industries, ...concepts];

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const updated = await upsertInChunks(supabase, rows);

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        industryCount: industries.length,
        conceptCount: concepts.length,
        generatedAt: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('sync-fund-topic failed:', err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
