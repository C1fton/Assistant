import { isArray, isBoolean, isFinite, isNumber, isPlainObject } from 'lodash';

export const ETF_GRID_SOURCE_URL = 'https://github.com/hushicai/ETF';

export const ETF_GRID_TYPES = Object.freeze({
  small: '小网',
  middle: '中网',
  big: '大网'
});

export const ETF_GRID_PERCENTS = Object.freeze({
  small: 0.05,
  middle: 0.15,
  big: 0.3
});

export const DEFAULT_ETF_GRID_SETTINGS = Object.freeze({
  targetName: '',
  targetCode: '',
  price: 1,
  amount: 10000,
  maxPercentOfDecline: 0.6,
  numberOfRetainedProfits: 2,
  increasePercentPerGrid: 0.05,
  hasMiddleGrid: true,
  hasBigGrid: true
});

const divide = (v1, v2) => parseFloat((v1 / v2).toPrecision(14));

const T_MIDDLE = divide(ETF_GRID_PERCENTS.middle, ETF_GRID_PERCENTS.small);
const T_BIG = divide(ETF_GRID_PERCENTS.big, ETF_GRID_PERCENTS.small);

export const toFixedString = (value, digits = 3) => {
  const num = isFinite(value) ? value : 0;
  return num.toFixed(digits);
};

export const toFixedNumber = (value, digits = 3) => parseFloat(toFixedString(value, digits));

const _toNumber = (value, fallback) => {
  const num = isNumber(value) ? value : Number(value);
  return isFinite(num) ? num : fallback;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const normalizeEtfGridSettings = (settings = {}) => {
  const input = isPlainObject(settings) ? settings : {};
  const targetName = String(input.targetName || '')
    .trim()
    .slice(0, 40);
  const targetCode = String(input.targetCode || '')
    .replace(/\D/g, '')
    .slice(0, 6);

  return {
    targetName,
    targetCode,
    price: clamp(_toNumber(input.price, DEFAULT_ETF_GRID_SETTINGS.price), 0.0001, 1000000),
    amount: clamp(_toNumber(input.amount, DEFAULT_ETF_GRID_SETTINGS.amount), 100, 100000000),
    maxPercentOfDecline: clamp(
      _toNumber(input.maxPercentOfDecline, DEFAULT_ETF_GRID_SETTINGS.maxPercentOfDecline),
      0.05,
      0.95
    ),
    numberOfRetainedProfits: clamp(
      _toNumber(input.numberOfRetainedProfits, DEFAULT_ETF_GRID_SETTINGS.numberOfRetainedProfits),
      0,
      100
    ),
    increasePercentPerGrid: clamp(
      _toNumber(input.increasePercentPerGrid, DEFAULT_ETF_GRID_SETTINGS.increasePercentPerGrid),
      0,
      1
    ),
    hasMiddleGrid: isBoolean(input.hasMiddleGrid) ? input.hasMiddleGrid : DEFAULT_ETF_GRID_SETTINGS.hasMiddleGrid,
    hasBigGrid: isBoolean(input.hasBigGrid) ? input.hasBigGrid : DEFAULT_ETF_GRID_SETTINGS.hasBigGrid
  };
};

export const createEtfGrid = (options) => {
  const { numberOfRetainedProfits, type, gear, price, percent, buyAmount: plannedBuyAmount } = options;
  const buyPrice = gear * price;
  const buyCount = buyPrice > 0 ? Math.floor(plannedBuyAmount / buyPrice / 100) * 100 : 0;
  const buyAmount = buyCount * buyPrice;
  const sellPrice = (gear + percent) * price;
  const currentAmount = buyCount * sellPrice;
  const profits = currentAmount - buyAmount;
  const returnRate = buyAmount > 0 ? `${toFixedString((profits / buyAmount) * 100, 2)}%` : '0.00%';
  let retainedProfits = profits * numberOfRetainedProfits;
  const sellCount = sellPrice > 0 ? Math.floor((currentAmount - retainedProfits) / sellPrice / 100) * 100 : 0;
  const sellAmount = sellCount * sellPrice;
  retainedProfits = currentAmount - sellAmount;
  const retainedCount = sellPrice > 0 ? retainedProfits / sellPrice : 0;

  return {
    type,
    gear,
    buyAmount,
    buyCount,
    buyPrice,
    sellPrice,
    sellAmount,
    sellCount,
    profits,
    returnRate,
    retainedProfits,
    retainedCount
  };
};

export const calculateEtfGrids = (rawSettings = {}) => {
  const settings = normalizeEtfGridSettings(rawSettings);
  const grids = [];
  const minGear = 1 - settings.maxPercentOfDecline;

  let gear = 1;
  let i = 0;
  let j = 0;
  let k = 0;

  while (gear >= minGear) {
    const buyAmount = toFixedNumber((settings.increasePercentPerGrid * i + 1) * settings.amount, 0);

    grids.push(
      createEtfGrid({
        type: ETF_GRID_TYPES.small,
        buyAmount,
        gear,
        percent: ETF_GRID_PERCENTS.small,
        numberOfRetainedProfits: settings.numberOfRetainedProfits,
        price: settings.price
      })
    );

    if (settings.hasMiddleGrid && i && i % T_MIDDLE === 0) {
      j += 1;
      grids.push(
        createEtfGrid({
          type: ETF_GRID_TYPES.middle,
          buyAmount,
          gear: toFixedNumber(1 - j * ETF_GRID_PERCENTS.middle),
          percent: ETF_GRID_PERCENTS.middle,
          numberOfRetainedProfits: settings.numberOfRetainedProfits,
          price: settings.price
        })
      );
    }

    if (settings.hasBigGrid && i && i % T_BIG === 0) {
      k += 1;
      grids.push(
        createEtfGrid({
          type: ETF_GRID_TYPES.big,
          buyAmount,
          gear: toFixedNumber(1 - k * ETF_GRID_PERCENTS.big),
          percent: ETF_GRID_PERCENTS.big,
          numberOfRetainedProfits: settings.numberOfRetainedProfits,
          price: settings.price
        })
      );
    }

    i += 1;
    gear = toFixedNumber(1 - i * ETF_GRID_PERCENTS.small);
  }

  const totals = grids.reduce(
    (prev, grid) => ({
      buyAmount: prev.buyAmount + grid.buyAmount,
      profits: prev.profits + grid.profits,
      retainedProfits: prev.retainedProfits + grid.retainedProfits
    }),
    { buyAmount: 0, profits: 0, retainedProfits: 0 }
  );
  const totalProfits = totals.profits + totals.retainedProfits;
  const totalReturnRate = totals.buyAmount > 0 ? (totalProfits / totals.buyAmount) * 100 : 0;

  return {
    settings,
    grids,
    totals: {
      ...totals,
      totalProfits,
      totalReturnRate,
      minGear,
      minPrice: minGear * settings.price
    }
  };
};

// -------------------------- 新增技术指标计算函数 --------------------------

/**
 * 计算移动平均线 MA
 * @param {Array<number>} prices 价格序列，最新价格在前
 * @param {number} period 周期
 * @returns {Array<number>} MA序列，长度为 prices.length - period + 1，最新值在前
 */
export const calculateMA = (prices, period) => {
  if (!isArray(prices) || prices.length < period || period < 1) {
    return [];
  }

  const result = [];
  let sum = 0;

  // 初始计算第一个MA
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  result.push(sum / period);

  // 滑动窗口计算后续MA
  for (let i = period; i < prices.length; i++) {
    sum = sum - prices[i - period] + prices[i];
    result.push(sum / period);
  }

  return result;
};

/**
 * 计算相对强弱指数 RSI
 * @param {Array<number>} prices 价格序列，最新价格在前
 * @param {number} period 周期，默认14
 * @returns {number|null} 最新RSI值，0-100之间
 */
export const calculateRSI = (prices, period = 14) => {
  if (!isArray(prices) || prices.length < period + 1 || period < 1) {
    return null;
  }

  let gainSum = 0;
  let lossSum = 0;

  // 计算初始周期内的涨跌
  for (let i = 0; i < period; i++) {
    const change = prices[i] - prices[i + 1];
    if (change > 0) {
      gainSum += change;
    } else if (change < 0) {
      lossSum += -change;
    }
  }

  // 初始RS和RSI
  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;

  if (avgLoss === 0) {
    return 100;
  }
  if (avgGain === 0) {
    return 0;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return toFixedNumber(rsi, 2);
};

/**
 * 计算真实波幅 ATR
 * @param {Array<number>} highs 最高价序列
 * @param {Array<number>} lows 最低价序列
 * @param {Array<number>} closes 收盘价序列，最新价格在前
 * @param {number} period 周期，默认14
 * @returns {number|null} 最新ATR值
 */
export const calculateATR = (highs, lows, closes, period = 14) => {
  if (
    !isArray(highs) ||
    !isArray(lows) ||
    !isArray(closes) ||
    highs.length < period + 1 ||
    highs.length !== lows.length ||
    highs.length !== closes.length
  ) {
    return null;
  }

  const trList = [];

  for (let i = 0; i < period; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i + 1];

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    const tr = Math.max(tr1, tr2, tr3);

    trList.push(tr);
  }

  const atr = trList.reduce((sum, tr) => sum + tr, 0) / period;
  return toFixedNumber(atr, 4);
};

/**
 * 计算历史波动率（年化）
 * @param {Array<number>} prices 价格序列，最新价格在前
 * @param {number} period 计算周期，默认20
 * @param {number} tradingDays 年化交易天数，默认252
 * @returns {number|null} 年化波动率（小数）
 */
export const calculateVolatility = (prices, period = 20, tradingDays = 252) => {
  if (!isArray(prices) || prices.length < period + 1 || period < 2) {
    return null;
  }

  // 计算收益率
  const returns = [];
  for (let i = 0; i < period; i++) {
    const ret = Math.log(prices[i] / prices[i + 1]);
    returns.push(ret);
  }

  // 计算收益率均值
  const mean = returns.reduce((sum, ret) => sum + ret, 0) / period;

  // 计算标准差
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / (period - 1);
  const stdDev = Math.sqrt(variance);

  // 年化波动率
  const volatility = stdDev * Math.sqrt(tradingDays);
  return toFixedNumber(volatility, 4);
};

/**
 * 计算支撑位和压力位
 * @param {Array<number>} prices 价格序列，最新价格在前
 * @param {number} lookback 回看周期，默认60
 * @returns {Object} 包含支撑位和压力位数组，按距离当前价格的远近排序
 */
export const calculateSupportResistance = (prices, lookback = 60) => {
  if (!isArray(prices) || prices.length < 20) {
    return { supports: [], resistances: [] };
  }

  const periodPrices = prices.slice(0, Math.min(lookback, prices.length));
  const currentPrice = periodPrices[0];
  const high = Math.max(...periodPrices);
  const low = Math.min(...periodPrices);

  // 斐波那契回调位
  const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786];
  const range = high - low;

  const supports = [];
  const resistances = [];

  // 斐波那契支撑压力位
  for (const level of fibLevels) {
    const price = low + range * level;
    if (price < currentPrice) {
      supports.push(price);
    } else if (price > currentPrice) {
      resistances.push(price);
    }
  }

  // 增加近期高低点
  supports.push(low);
  resistances.push(high);

  // 按距离当前价格的远近排序
  supports.sort((a, b) => currentPrice - a - (currentPrice - b));
  resistances.sort((a, b) => a - currentPrice - (b - currentPrice));

  return {
    supports: supports.map((v) => toFixedNumber(v, 4)),
    resistances: resistances.map((v) => toFixedNumber(v, 4))
  };
};

/**
 * 评估网格策略适配性
 * @param {Array<number>} prices 价格序列，最新价格在前
 * @param {Array<number>} volumes 成交量序列，最新在前
 * @param {number} period 分析周期，默认60
 * @returns {Object} 适配性评分和建议
 */
export const assessGridSuitability = (prices, volumes = [], period = 60) => {
  const result = {
    score: 50, // 0-100分
    trend: '震荡', // 上升/震荡/下跌
    volatilityLevel: '中等', // 低/中等/高
    liquidity: '良好', // 差/一般/良好
    suggestion: '',
    details: []
  };

  if (!isArray(prices) || prices.length < 30) {
    result.suggestion = '价格数据不足，无法准确评估';
    return result;
  }

  // 1. 趋势判断：通过MA排列和涨跌幅判断
  const ma20 = calculateMA(prices, 20);
  const ma60 = calculateMA(prices, 60);

  let trendScore = 50;
  if (ma20.length > 0 && ma60.length > 0) {
    const ma20Current = ma20[0];
    const ma60Current = ma60[0];
    const ma20Prev = ma20[Math.min(5, ma20.length - 1)];
    const ma60Prev = ma60[Math.min(5, ma60.length - 1)];

    const ma20Trend = (ma20Current - ma20Prev) / ma20Prev;
    const ma60Trend = (ma60Current - ma60Prev) / ma60Prev;

    if (ma20Current > ma60Current && ma20Trend > 0 && ma60Trend > 0) {
      result.trend = '上升';
      trendScore = 60;
      result.details.push('当前处于上升趋势，建议设置更宽的网格间距并适当提高持仓上限');
    } else if (ma20Current < ma60Current && ma20Trend < 0 && ma60Trend < 0) {
      result.trend = '下跌';
      trendScore = 30;
      result.details.push('当前处于下跌趋势，建议减少底仓或等待趋势明朗后再布局');
    } else {
      result.trend = '震荡';
      trendScore = 95;
      result.details.push('当前处于震荡市，是网格策略的最佳适用场景');
    }
  } else if (prices.length >= 20) {
    // 数据不足时用简单涨跌幅判断
    const startPrice = prices[Math.min(20, prices.length - 1)];
    const endPrice = prices[0];
    const change = (endPrice - startPrice) / startPrice;
    if (Math.abs(change) < 0.05) {
      result.trend = '震荡';
      trendScore = 90;
      result.details.push('近期价格走势平稳，适合网格策略');
    } else if (change > 0) {
      result.trend = '上升';
      trendScore = 55;
      result.details.push('近期处于上升趋势，建议适当提高网格上轨');
    } else {
      result.trend = '下跌';
      trendScore = 30;
      result.details.push('近期处于下跌趋势，建议控制仓位风险');
    }
  }

  // 2. 波动率评估
  const volatility20 = calculateVolatility(prices, 20);
  if (volatility20 !== null) {
    if (volatility20 < 0.15) {
      result.volatilityLevel = '低';
      result.details.push(
        `近20日波动率为${(volatility20 * 100).toFixed(2)}%，波动较小，网格收益可能偏低，建议适当缩小网格间距`
      );
      result.score += 10;
    } else if (volatility20 < 0.35) {
      result.volatilityLevel = '中等';
      result.details.push(`近20日波动率为${(volatility20 * 100).toFixed(2)}%，波动适中，非常适合网格策略`);
      result.score += 25;
    } else {
      result.volatilityLevel = '高';
      result.details.push(
        `近20日波动率为${(volatility20 * 100).toFixed(2)}%，波动较大，建议适当放宽网格间距并控制总仓位`
      );
      result.score += 15;
    }
  } else {
    result.details.push('波动率数据不足，建议根据历史波动情况手动设置网格参数');
  }

  // 3. 流动性评估（如果有成交量数据）
  result.score = Math.round((result.score + trendScore) / 2);

  if (isArray(volumes) && volumes.length >= 10) {
    const avgVolume = volumes.slice(0, 10).reduce((sum, v) => sum + v, 0) / 10;
    if (avgVolume < 1000000) {
      // 100万份以下
      result.liquidity = '差';
      result.details.push('近期成交量较低，流动性较差，可能存在冲击成本，建议谨慎操作');
      result.score -= 20;
    } else if (avgVolume < 10000000) {
      // 1000万份以下
      result.liquidity = '一般';
      result.details.push('近期成交量适中，流动性较好，适合网格操作');
      result.score += 10;
    } else {
      result.liquidity = '良好';
      result.details.push('近期成交量较大，流动性良好，非常适合网格策略');
      result.score += 20;
    }
  }

  // 4. 计算综合得分
  result.score = Math.round(Math.max(0, Math.min(100, result.score)));

  // 5. 综合建议
  if (result.score >= 80) {
    result.suggestion = '非常适合网格策略，可以按照默认参数或者微调后开始布局';
  } else if (result.score >= 60) {
    result.suggestion = '比较适合网格策略，建议根据趋势和波动率适当调整参数后使用';
  } else if (result.score >= 40) {
    result.suggestion = '基本适合网格策略，需要控制仓位并严格遵守操作纪律';
  } else {
    result.suggestion = '当前环境不太适合网格策略，建议观望或者选择其他更合适的标的';
  }

  return result;
};
