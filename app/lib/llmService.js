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

const DEFAULT_MODEL_CONFIG = {
  maxTokens: 4096,
  temperature: 0.7
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
  const apiKey = options.apiKey || getClientStorageValue('llm_api_key');
  const baseUrl = options.baseUrl || getClientStorageValue('llm_base_url') || 'https://api.openai.com/v1';
  const defaultModel = options.model || getClientStorageValue('llm_model') || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('请先在设置中配置 LLM API 密钥');
  }

  const model = options.model || defaultModel;
  const config = MODEL_CONFIG[model] || DEFAULT_MODEL_CONFIG;

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
const analysisFrame = [
  '',
  '请按以下固定结构输出：',
  '1. 今日结论：用 3 条以内说明当前最重要的判断。',
  '2. 数据依据：列出你从输入数据里实际使用的关键字段，不要编造输入中没有的数据。',
  '3. 异常与风险：列出集中度、波动、回撤、行业/主题拥挤、单只基金占比等风险。',
  '4. 机会与催化：只基于输入中的估值、涨跌、主题、指数或持仓变化推断。',
  '5. 操作清单：给出“观察 / 加仓 / 减仓 / 不操作”的条件化建议，避免绝对化承诺。',
  '6. 风险提示：最后说明这不是投资建议，且数据可能延迟。'
];

/**
 * Prompt 模板集合
 */
export const PROMPT_TEMPLATES = {
  holdingAnalysis: joinPrompt([
    '你是专业的基金组合分析助手。请模仿“每日市场扫描报告”的工作流：先读数据快照，再找异常，再输出行动清单。',
    '重点分析持仓比例、收益贡献、估值波动、主题/行业集中度、单只基金过度集中风险。',
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
    ...analysisFrame
  ]),

  marketAnalysis: joinPrompt([
    '你是专业的市场扫描助手。请根据输入的市场快照，输出今日市场热点、风险、可观察信号和基金操作启发。',
    '如果市场快照字段有限，请明确说明哪些判断是基于有限数据的推断。',
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
    ...analysisFrame
  ]),

  rebalanceAdvice: joinPrompt([
    '你是专业的基金调仓助手。请基于组合和市场快照输出条件化调仓方案。',
    '建议必须可执行，但不能给出保证收益或“一定买卖”的结论；用触发条件表达，例如“若单只占比超过 X% 则考虑”。',
    '',
    '组合数据快照：',
    '{{holdingsData}}',
    '',
    '市场数据快照：',
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
