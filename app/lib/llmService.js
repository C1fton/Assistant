/**
 * LLM API 封装层
 * 支持 OpenAI 兼容的大模型服务（OpenAI、DeepSeek、Moonshot、Qwen 等）。
 */
import { storageStore } from '@/app/stores/storageStore';

const MODEL_CONFIG = {
  'gpt-4o': {
    maxTokens: 4096,
    temperature: 0.7,
    description: 'OpenAI GPT-4o，综合能力最强'
  },
  'gpt-3.5-turbo': {
    maxTokens: 4096,
    temperature: 0.7,
    description: 'OpenAI GPT-3.5，性价比高'
  },
  'deepseek-chat': {
    maxTokens: 4096,
    temperature: 0.7,
    description: '深度求索，中文能力优秀'
  },
  'moonshot-v1-8k': {
    maxTokens: 8000,
    temperature: 0.7,
    description: '月之暗面，长文本能力强'
  }
};

const DEFAULT_MODEL_CONFIG = {
  maxTokens: 4096,
  temperature: 0.7
};

export const LLM_PROVIDERS = {
  openai: {
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini'
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest'
  }
};

const getClientStorageValue = (key) => {
  if (typeof window === 'undefined') return '';
  try {
    return storageStore.getItem(key, '') || '';
  } catch {
    return '';
  }
};

const normalizeBaseUrl = (baseUrl) =>
  String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');

const uniq = (items) => [...new Set(items.filter(Boolean))];

const getEndpointCandidates = (baseUrl, provider) => {
  const base = normalizeBaseUrl(baseUrl);
  if (provider === 'anthropic') {
    return [base.endsWith('/messages') ? base : base + '/messages'];
  }
  if (/\/(?:chat\/completions|completions)$/i.test(base)) {
    return [base];
  }
  return uniq([base + '/chat/completions', /\/api\/coding\/v\d+$/i.test(base) ? base + '/completions' : '']);
};

const normalizeProvider = (provider) => (provider === 'anthropic' ? 'anthropic' : 'openai');

const getMessageContent = (message) => String(message?.content || '').trim();

const normalizeOpenAiMessages = (messages, foldSystem = false) => {
  const normalMessages = messages
    .filter((message) => message?.role !== 'system')
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: getMessageContent(message)
    }))
    .filter((message) => message.content);

  if (!foldSystem) {
    const systemMessages = messages
      .filter((message) => message?.role === 'system')
      .map((message) => ({ role: 'system', content: getMessageContent(message) }))
      .filter((message) => message.content);
    return [...systemMessages, ...normalMessages].length
      ? [...systemMessages, ...normalMessages]
      : [{ role: 'user', content: '请回复：连接成功' }];
  }

  const system = messages
    .filter((message) => message?.role === 'system')
    .map(getMessageContent)
    .filter(Boolean)
    .join('\n\n');

  if (!system) return normalMessages.length ? normalMessages : [{ role: 'user', content: '请回复：连接成功' }];
  if (!normalMessages.length) return [{ role: 'user', content: system }];
  return [
    {
      ...normalMessages[0],
      content: `${system}\n\n${normalMessages[0].content}`
    },
    ...normalMessages.slice(1)
  ];
};

const openAiPayloadVariants = [
  { name: 'standard', tokenKey: 'max_tokens', withTemperature: true, foldSystem: false },
  { name: 'max_completion_tokens', tokenKey: 'max_completion_tokens', withTemperature: false, foldSystem: false },
  { name: 'minimal', tokenKey: '', withTemperature: false, foldSystem: false },
  { name: 'minimal_no_system', tokenKey: '', withTemperature: false, foldSystem: true }
];

const toOpenAiChatPayload = (messages, model, config, options, variant) => {
  const payload = {
    model,
    messages: normalizeOpenAiMessages(messages, variant.foldSystem),
    stream: false
  };
  if (variant.withTemperature) {
    payload.temperature = options.temperature ?? config.temperature;
  }
  if (variant.tokenKey) {
    payload[variant.tokenKey] = options.maxTokens ?? config.maxTokens;
  }
  return payload;
};

const toOpenAiCompletionPayload = (messages, model, config, options, variant) => {
  const prompt = normalizeOpenAiMessages(messages, true)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n');
  const payload = {
    model,
    prompt: prompt || '请回复：连接成功',
    stream: false
  };
  if (variant.withTemperature) {
    payload.temperature = options.temperature ?? config.temperature;
  }
  if (variant.tokenKey === 'max_tokens') {
    payload.max_tokens = options.maxTokens ?? config.maxTokens;
  }
  return payload;
};

const parseOpenAiResult = (data) =>
  data?.choices?.[0]?.message?.content?.trim() || data?.choices?.[0]?.text?.trim() || data?.output_text?.trim() || '';

const readErrorMessage = async (response) => {
  let message = 'API 调用失败: ' + response.status;
  try {
    const text = await response.text();
    if (!text) return message;
    try {
      const error = JSON.parse(text);
      message = error?.error?.message || error?.message || text.slice(0, 300) || message;
    } catch {
      message = text.slice(0, 300) || message;
    }
  } catch {
    // ignore unreadable error body
  }
  return message;
};

const formatOpenAiErrors = (errors) => {
  if (
    errors.length &&
    errors.every((item) => /Failed to fetch|Load failed|NetworkError|网络请求失败/i.test(item.message))
  ) {
    return '网络或跨域请求失败。如果 API 地址、模型和密钥都正确，说明该服务可能不允许浏览器/GitHub Pages 直连，需要改用支持 CORS 的网关或后端代理。';
  }
  const compact = errors
    .map((item) => `${item.endpoint.replace(/^https?:\/\//, '')} [${item.variant}]：${item.message}`)
    .slice(0, 4)
    .join('；');
  return compact || '请检查 API 配置';
};

const callOpenAiCompatible = async ({ messages, model, config, options, apiKey, baseUrl }) => {
  const endpoints = getEndpointCandidates(baseUrl, 'openai');
  const errors = [];

  for (const endpoint of endpoints) {
    const isCompletionEndpoint = /\/completions$/i.test(endpoint) && !/\/chat\/completions$/i.test(endpoint);
    const variants = isCompletionEndpoint
      ? openAiPayloadVariants.filter((variant) => variant.tokenKey !== 'max_completion_tokens')
      : openAiPayloadVariants;

    for (const variant of variants) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey
          },
          body: JSON.stringify(
            isCompletionEndpoint
              ? toOpenAiCompletionPayload(messages, model, config, options, variant)
              : toOpenAiChatPayload(messages, model, config, options, variant)
          )
        });

        if (response.ok) {
          const data = await response.json();
          return parseOpenAiResult(data);
        }

        const message = await readErrorMessage(response);
        errors.push({ endpoint, variant: variant.name, message });
        if (response.status === 401 || response.status === 403) {
          throw new Error(message);
        }
      } catch (error) {
        errors.push({ endpoint, variant: variant.name, message: error?.message || '网络请求失败' });
        if (error?.message && !/Failed to fetch|Load failed|NetworkError/i.test(error.message)) {
          throw error;
        }
      }
    }
  }

  throw new Error(formatOpenAiErrors(errors));
};

const toAnthropicPayload = (messages, model, config, options) => {
  const system = messages
    .filter((message) => message?.role === 'system')
    .map((message) => String(message?.content || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const anthropicMessages = messages
    .filter((message) => message?.role !== 'system')
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || '')
    }))
    .filter((message) => message.content);

  return {
    model,
    messages: anthropicMessages.length ? anthropicMessages : [{ role: 'user', content: '请回复：连接成功' }],
    max_tokens: options.maxTokens ?? config.maxTokens,
    temperature: options.temperature ?? config.temperature,
    ...(system ? { system } : {})
  };
};

/**
 * 调用 LLM API
 * @param {Array} messages - 对话消息数组
 * @param {Object} options - 配置选项
 * @param {string} options.model - 模型名称
 * @param {number} options.temperature - 温度参数
 * @param {number} options.maxTokens - 最大生成长度
 * @returns {Promise<string>} 模型返回结果
 */
export const callLLM = async (messages, options = {}) => {
  const provider = normalizeProvider(options.provider || getClientStorageValue('llm_provider'));
  const providerDefaults = LLM_PROVIDERS[provider] || LLM_PROVIDERS.openai;
  const apiKey = options.apiKey || getClientStorageValue('llm_api_key');
  const baseUrl = options.baseUrl || getClientStorageValue('llm_base_url') || providerDefaults.defaultBaseUrl;
  const defaultModel = options.model || getClientStorageValue('llm_model') || providerDefaults.defaultModel;

  if (!apiKey) {
    throw new Error('请先在设置中配置 LLM API 密钥');
  }

  const model = options.model || defaultModel;
  const config = MODEL_CONFIG[model] || DEFAULT_MODEL_CONFIG;

  if (provider !== 'anthropic') {
    return callOpenAiCompatible({ messages, model, config, options, apiKey, baseUrl });
  }

  const endpoint = getEndpointCandidates(baseUrl, provider)[0];
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': options.anthropicVersion || '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(toAnthropicPayload(messages, model, config, options))
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const data = await response.json();
  return (
    data?.content
      ?.map((block) => (block?.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim() || ''
  );
};

const joinPrompt = (lines) => lines.join('\n');
const analysisFrame = [
  '',
  '请按以下固定结构输出：',
  '1. 今日结论：用 3 条以内说明当前最重要的判断。',
  '2. 数据依据：列出你从输入数据里实际使用的关键字段，不要编造输入中没有的数据。',
  '3. 异常与风险：列出集中度、波动、回撤、行业/主题拥挤、单只基金占比等风险。',
  '4. 机会与催化：只基于输入中的估值、涨跌、主题、指数或持仓变化推断。',
  '5. 逐基金操作清单：必须覆盖输入中每一只有持仓的基金，用 Markdown 表格输出“基金代码 / 名称 / 今日动作 / 建议金额或仓位变化 / 触发条件 / 核心理由”。今日动作只能选：加仓、减仓、持有、暂停观察。',
  '6. 组合层面动作：说明今天总体应该偏进攻、防守还是观望，并给出现金预留比例或仓位上限建议。',
  '7. 风险提示：最后说明这不是投资建议，且数据可能延迟。',
  '所有金额建议必须是区间或上限，不允许给“一定买入/卖出”的绝对指令。'
];

/**
 * Prompt 模板集合
 */
export const PROMPT_TEMPLATES = {
  holdingAnalysis: joinPrompt([
    '你是专业的基金组合分析助手。请模仿“每日市场扫描报告”的工作流：先读数据快照，再找异常，再输出行动清单。',
    '重点分析持仓比例、收益贡献、估值波动、主题/行业集中度、单只基金过度集中风险。',
    '必须使用 exposureSummary、typeExposure、themeExposure、topConcentration 和 decisionHints 字段，输出组合暴露结构。',
    '',
    '组合数据快照：',
    '{{holdingsData}}',
    ...analysisFrame
  ]),

  fundRecommendation: joinPrompt([
    '你是专业的基金组合补全助手。请先识别当前组合缺口，再给出适合风险偏好的基金方向。',
    '不要虚构具体基金代码；如果输入里没有候选基金池，只能推荐基金类别、主题方向和筛选条件。',
    '',
    '组合数据快照：',
    '{{holdingsData}}',
    '',
    '用户风险偏好：{{riskPreference}}',
    '',
    '推荐必须转换成当前组合的实际执行建议：如果建议补充某类资产，请说明应从哪些现有基金减仓腾挪，或建议新增观察标的类别。',
    ...analysisFrame
  ]),

  marketAnalysis: joinPrompt([
    '你是专业的市场扫描助手。请根据输入的市场快照，输出今日市场热点、风险、可观察信号和基金操作启发。',
    '如果市场快照字段有限，请明确说明哪些判断是基于有限数据的推断。',
    '必须使用 marketTemperature、strongSectors、weakSectors、inflowSectors 和 valuationLeaders 字段，判断今天更适合进攻、防守还是观望。',
    '',
    '市场数据快照：',
    '{{marketData}}',
    ...analysisFrame
  ]),

  riskWarning: joinPrompt([
    '你是专业的基金风控助手。请像风控日报一样排查组合风险，不做乐观预测，优先提示需要用户确认的风险点。',
    '重点关注：单只基金/主题集中度、估值大幅波动、盈利回撤、市场指数共振下跌、持仓数据缺失。',
    '',
    '组合数据快照：',
    '{{holdingsData}}',
    '',
    '市场数据快照：',
    '{{marketData}}',
    '',
    '请把风险映射到具体基金，指出哪只基金今天应该减仓、暂停加仓或仅观察。',
    ...analysisFrame
  ]),

  rebalanceAdvice: joinPrompt([
    '你是专业的基金调仓助手。请基于组合和市场快照输出条件化调仓方案。',
    '你的输出必须直接、细节化、逐基金。不要只说原则。必须给出每只持仓基金今天更适合“加仓 / 减仓 / 持有 / 暂停观察”中的哪一种。',
    '建议金额必须基于输入里的 totalAmount、holdingAmount 和 ratio 推导。若缺少现金数据，按“以当前组合市值的百分比”给出，例如“加仓组合总额 1%-2%”或“减仓该基金 10%-20%”。',
    '建议必须包含触发条件，例如“若今日估值跌幅继续超过 -3% 且该基金占比低于 8%，可小额加仓组合总额 1%”。',
    '如果基金今日跌幅很大但主题集中度已经过高，必须优先提示不要盲目补仓；如果基金盈利较多且今日继续冲高，可以给出分批止盈比例。',
    '输出表格必须尽量量化，例如“加仓该基金现持仓金额的 5%-10%”“减仓该基金现持仓金额的 10%-20%”“不超过组合总额 1%”。',
    '不能承诺收益，不能说一定买卖；但要给出可执行区间。',
    '',
    '组合数据快照：',
    '{{holdingsData}}',
    '',
    '市场数据快照：',
    '{{marketData}}',
    ...analysisFrame
  ]),

  historyReview: joinPrompt([
    '你是专业的基金投资复盘助手。请复盘历史 AI 建议，不要假设用户已经执行建议，除非历史记录明确写出。',
    '你需要比较“历史建议”和“当前组合/市场快照”，判断哪些建议仍然有效、哪些需要撤销、哪些需要降低仓位或提高观察优先级。',
    '输出必须包含：',
    '1. 历史建议有效性：按时间列出最近建议的结论是否仍成立。',
    '2. 偏差来源：说明是市场温度变化、板块强弱变化、持仓占比变化还是数据缺失导致建议变化。',
    '3. 当前行动修正：用 Markdown 表格输出“基金代码 / 原建议 / 当前修正 / 建议金额或仓位变化 / 触发条件”。',
    '4. 下一次复盘观察点：列出需要关注的 3-5 个数据触发点。',
    '',
    '历史建议记录：',
    '{{historyData}}',
    '',
    '当前组合数据快照：',
    '{{holdingsData}}',
    '',
    '当前市场数据快照：',
    '{{marketData}}',
    ...analysisFrame
  ])
};

/**
 * 渲染 Prompt 模板
 * @param {string} template - 模板内容
 * @param {Object} data - 模板数据
 * @returns {string} 渲染后的 Prompt
 */
export const renderPrompt = (template, data) => {
  return template.replace(/{{(\w+)}}/g, (match, key) => data[key] || '');
};
