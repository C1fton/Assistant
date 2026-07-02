/**
 * LLM API 封装层
 * 支持 OpenAI 兼容的大模型服务（OpenAI、DeepSeek、Moonshot、Qwen 等）。
 */

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

const getClientStorageValue = (key) => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
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
  const apiKey = process.env.NEXT_PUBLIC_LLM_API_KEY || getClientStorageValue('llm_api_key');
  const baseUrl =
    process.env.NEXT_PUBLIC_LLM_BASE_URL || getClientStorageValue('llm_base_url') || 'https://api.openai.com/v1';
  const defaultModel = process.env.NEXT_PUBLIC_LLM_MODEL || getClientStorageValue('llm_model') || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('请先在设置中配置 LLM API 密钥');
  }

  const model = options.model || defaultModel;
  const config = MODEL_CONFIG[model] || MODEL_CONFIG['gpt-3.5-turbo'];

  const response = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? config.temperature,
      max_tokens: options.maxTokens ?? config.maxTokens,
      stream: false
    })
  });

  if (!response.ok) {
    let message = 'API 调用失败: ' + response.status;
    try {
      const error = await response.json();
      message = error?.error?.message || message;
    } catch {
      // ignore non-json error body
    }
    throw new Error(message);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
};

const joinPrompt = (lines) => lines.join('\n');

/**
 * Prompt 模板集合
 */
export const PROMPT_TEMPLATES = {
  holdingAnalysis: joinPrompt([
    '你是专业的基金投资分析师，请根据用户提供的持仓数据，进行全面的分析：',
    '1. 持仓比例分析：计算单只基金的占比，判断是否过于集中',
    '2. 风险分散程度：分析持仓基金的类型分布（股票型、混合型、债券型、指数型等），判断风险分散情况',
    '3. 行业集中度：分析基金的持仓行业分布，判断是否存在行业过于集中的风险',
    '4. 收益表现分析：结合各基金的历史收益情况，分析整体持仓的收益能力',
    '5. 优化建议：给出具体的持仓优化建议',
    '',
    '用户持仓数据：',
    '{{holdingsData}}',
    '',
    '请用中文回答，结构清晰，分点列出，专业但通俗易懂，不要使用 Markdown 格式。'
  ]),

  fundRecommendation: joinPrompt([
    '你是专业的基金投资顾问，请根据用户的持仓情况和风险偏好，推荐合适的基金：',
    '1. 首先分析用户当前持仓的风格和缺口',
    '2. 推荐 3-5 只符合用户风险偏好的优质基金，说明推荐理由',
    '3. 给出买入建议和仓位配置建议',
    '',
    '用户现有持仓：',
    '{{holdingsData}}',
    '',
    '用户风险偏好：{{riskPreference}}',
    '',
    '请用中文回答，结构清晰，分点列出，专业但通俗易懂，不要使用 Markdown 格式。'
  ]),

  marketAnalysis: joinPrompt([
    '你是专业的市场分析师，请结合最新的市场行情和热点新闻，分析当前市场趋势：',
    '1. 当前市场整体情况分析（A股、港股、美股等主要市场）',
    '2. 热点板块解读，分析上涨/下跌的原因和可持续性',
    '3. 给出当前市场环境下的操作建议',
    '4. 中长期市场趋势展望',
    '',
    '最新市场数据：',
    '{{marketData}}',
    '',
    '请用中文回答，结构清晰，分点列出，专业但通俗易懂，不要使用 Markdown 格式。'
  ]),

  riskWarning: joinPrompt([
    '你是专业的风控分析师，请根据用户的持仓数据和最新市场情况，进行风险排查：',
    '1. 检查持仓基金是否有大幅波动、利空消息、大额赎回等风险',
    '2. 分析整体持仓的风险敞口，提示潜在的下跌风险',
    '3. 给出具体的风险应对建议',
    '',
    '用户持仓数据：',
    '{{holdingsData}}',
    '',
    '最新市场动态：',
    '{{marketData}}',
    '',
    '请用中文回答，结构清晰，分点列出，专业但通俗易懂，重点突出风险点，不要使用 Markdown 格式。'
  ]),

  rebalanceAdvice: joinPrompt([
    '你是专业的投资顾问，请根据用户的持仓情况和当前市场情况，给出调仓建议：',
    '1. 分析当前持仓的优缺点',
    '2. 给出具体的加仓/减仓/换仓建议，说明理由',
    '3. 给出调整后的持仓结构和预期收益风险情况',
    '4. 调仓操作的注意事项',
    '',
    '用户现有持仓：',
    '{{holdingsData}}',
    '',
    '当前市场情况：',
    '{{marketData}}',
    '',
    '请用中文回答，结构清晰，分点列出，专业但通俗易懂，建议要具体可执行，不要使用 Markdown 格式。'
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
