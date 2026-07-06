// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

console.info('llm-proxy server started');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const allowedHosts = [
  /^api\.openai\.com$/i,
  /^api\.anthropic\.com$/i,
  /^ark\.[a-z0-9-]+\.volces\.com$/i,
  /^api\.deepseek\.com$/i,
  /^dashscope\.aliyuncs\.com$/i,
  /^api\.moonshot\.cn$/i,
  /^openrouter\.ai$/i,
  /^api\.siliconflow\.cn$/i,
  /^api\.minimax\.chat$/i,
  /^open\.bigmodel\.cn$/i,
  /^api\.zhipuai\.cn$/i,
  /^api\.x\.ai$/i,
  /^api\.groq\.com$/i,
  /^api\.together\.xyz$/i,
  /^api\.mistral\.ai$/i
];

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

const isAllowedEndpoint = (endpoint: string) => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return allowedHosts.some((pattern) => pattern.test(url.hostname));
};

const readUpstreamJson = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const provider = body?.provider === 'anthropic' ? 'anthropic' : 'openai';
    const endpoint = String(body?.endpoint || '').trim();
    const apiKey = String(body?.apiKey || '').trim();
    const payload = body?.payload;

    if (!endpoint || !isAllowedEndpoint(endpoint)) {
      return jsonResponse({ success: false, error: '不允许代理到该 API 地址' });
    }

    if (!apiKey) {
      return jsonResponse({ success: false, error: '缺少 API 密钥' });
    }

    if (!payload || typeof payload !== 'object') {
      return jsonResponse({ success: false, error: '缺少请求参数' });
    }

    const normalizedPayload = { ...payload, stream: false };
    const serializedPayload = JSON.stringify(normalizedPayload);
    if (serializedPayload.length > 200_000) {
      return jsonResponse({ success: false, error: '请求内容过大' });
    }

    const headers =
      provider === 'anthropic'
        ? {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': String(body?.anthropicVersion || '2023-06-01')
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          };

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: serializedPayload
    });

    const data = await readUpstreamJson(upstream);

    if (!upstream.ok) {
      const error =
        data?.error?.message ||
        data?.message ||
        data?.text ||
        `上游 LLM API 调用失败：${upstream.status} ${upstream.statusText}`;
      return jsonResponse({ success: false, status: upstream.status, error });
    }

    return jsonResponse({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('llm-proxy 服务端错误:', message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
