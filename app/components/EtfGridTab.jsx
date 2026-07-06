'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Calculator,
  ChevronDown,
  Download,
  HelpCircle,
  LineChart,
  RefreshCw,
  RotateCcw,
  Shield,
  Target,
  TrendingUp
} from 'lucide-react';
import { isArray, isEqual, isFinite, isNil, isPlainObject } from 'lodash';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchFundHistory, fetchMarketIndices } from '@/app/api/fund';
import { useStorageStore } from '@/app/stores';
import {
  assessGridSuitability,
  calculateEtfGrids,
  calculateMA,
  calculateRSI,
  calculateSupportResistance,
  calculateVolatility,
  DEFAULT_ETF_GRID_SETTINGS,
  ETF_GRID_SOURCE_URL,
  ETF_GRID_TYPES,
  normalizeEtfGridSettings,
  toFixedString
} from '@/app/lib/etfGrid';

const PERCENT_FIELDS = new Set(['maxPercentOfDecline', 'increasePercentPerGrid']);
const ANALYSIS_MIN_POINTS = 30;
const EMPTY_HISTORY = [];
const EMPTY_MARKET = [];
const MARKET_CONTEXT_NAMES = new Set(['上证指数', '沪深300', '创业板指', '中证500', '科创50']);

const TABLE_COLUMNS = [
  '序号',
  '种类',
  '档位',
  '买入价格',
  '买入数量',
  '买入金额',
  '卖出价格',
  '卖出数量',
  '卖出金额',
  '盈利金额',
  '盈利比例',
  '本期留存利润',
  '本期留存数量'
];

const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return isFinite(num) ? num : fallback;
};

const formatNumber = (value, digits = 0) =>
  toSafeNumber(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });

const formatInputPercent = (value) => {
  const text = String(toFixedString(toSafeNumber(value) * 100, 2)).replace(/\.?0+$/, '');
  return text || '0';
};

const formatSignedPercent = (value) => {
  const num = toSafeNumber(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${toFixedString(num, 2)}%`;
};

const parseFieldValue = (key, value) => {
  if (PERCENT_FIELDS.has(key)) return toSafeNumber(value) / 100;
  return toSafeNumber(value);
};

const getRowClassName = (type) => {
  if (type === ETF_GRID_TYPES.middle) return 'etf-grid-row etf-grid-row-middle';
  if (type === ETF_GRID_TYPES.big) return 'etf-grid-row etf-grid-row-big';
  return 'etf-grid-row';
};

const getSuitabilityClassName = (score) => {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
};

const getMarketToneClassName = (tone) => {
  if (tone === 'strong') return 'strong';
  if (tone === 'weak') return 'weak';
  return 'neutral';
};

const escapeCsv = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const getCandidateFundCode = (settings) => {
  const code = String(settings.targetCode || '')
    .replace(/\D/g, '')
    .slice(0, 6);
  if (code.length === 6) return code;

  const match = String(settings.targetName || '').match(/\d{6}/);
  return match ? match[0] : '';
};

const normalizeHistoryRows = (rows) => {
  if (!isArray(rows)) return EMPTY_HISTORY;

  return rows
    .map((row) => {
      if (!isPlainObject(row)) return null;
      const value = toSafeNumber(row.unitNetValue ?? row.value, null);
      if (isNil(value) || value <= 0) return null;
      return {
        date: String(row.date || ''),
        value
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
    .reverse();
};

const normalizeMarketIndices = (list) => {
  if (!isArray(list)) return EMPTY_MARKET;

  return list
    .map((item) => {
      if (!isPlainObject(item) || !MARKET_CONTEXT_NAMES.has(item.name)) return null;
      return {
        name: item.name,
        changePercent: toSafeNumber(item.changePercent, null)
      };
    })
    .filter((item) => item && !isNil(item.changePercent));
};

const summarizeMarketContext = (indices) => {
  if (!indices.length) {
    return {
      label: '暂无大盘数据',
      tone: 'neutral',
      avgChange: null,
      desc: '指数快照暂未获取，先以 ETF 自身净值走势为主。'
    };
  }

  const avgChange = indices.reduce((sum, item) => sum + item.changePercent, 0) / indices.length;
  const strongest = indices.reduce((prev, item) => (item.changePercent > prev.changePercent ? item : prev), indices[0]);
  const weakest = indices.reduce((prev, item) => (item.changePercent < prev.changePercent ? item : prev), indices[0]);

  if (avgChange >= 0.8) {
    return {
      label: '市场偏强',
      tone: 'strong',
      avgChange,
      desc: `核心指数均值 ${formatSignedPercent(avgChange)}，${strongest.name} 领涨 ${formatSignedPercent(
        strongest.changePercent
      )}。`
    };
  }

  if (avgChange <= -0.8) {
    return {
      label: '市场偏弱',
      tone: 'weak',
      avgChange,
      desc: `核心指数均值 ${formatSignedPercent(avgChange)}，${weakest.name} 承压 ${formatSignedPercent(
        weakest.changePercent
      )}。`
    };
  }

  return {
    label: '市场震荡',
    tone: 'neutral',
    avgChange,
    desc: `核心指数均值 ${formatSignedPercent(avgChange)}，整体更接近震荡环境。`
  };
};

const buildAnalysisResult = (rows, marketIndices) => {
  if (!isArray(rows) || rows.length < ANALYSIS_MIN_POINTS) return null;

  const prices = rows.map((row) => row.value);
  const ma5 = calculateMA(prices, 5);
  const ma20 = calculateMA(prices, 20);
  const ma60 = calculateMA(prices, 60);
  const rsi = calculateRSI(prices, 14);
  const volatility = calculateVolatility(prices, 20);
  const supportResistance = calculateSupportResistance(prices, 60);
  const suitability = assessGridSuitability(prices, [], Math.min(60, prices.length));
  const periodBase = prices[prices.length - 1];
  const periodReturn = periodBase > 0 ? ((prices[0] - periodBase) / periodBase) * 100 : 0;
  const market = summarizeMarketContext(marketIndices);
  const details = [...suitability.details];

  if (!isNil(market.avgChange)) {
    if (market.tone === 'strong') {
      details.push('大盘短线偏强，若追高建网格，建议把首格买入金额放低并放宽买入间距。');
    } else if (market.tone === 'weak') {
      details.push('大盘短线偏弱，适合降低单格金额，优先确认最大跌幅预算是否足够。');
    } else {
      details.push('大盘处于震荡区间，网格策略的适配度相对更高。');
    }
  }

  return {
    latestDate: rows[0].date,
    sampleSize: rows.length,
    latestValue: prices[0],
    periodReturn,
    ma5: ma5[0] ?? null,
    ma20: ma20[0] ?? null,
    ma60: ma60[0] ?? null,
    rsi,
    volatility,
    support: supportResistance.supports[0] ?? null,
    resistance: supportResistance.resistances[0] ?? null,
    market,
    suitability: {
      ...suitability,
      details
    }
  };
};

function Field({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  step = '0.01',
  type = 'number',
  placeholder,
  description,
  example,
  hint,
  inputMode,
  maxLength
}) {
  const inputId = useMemo(() => `field-${label.replace(/\s+/g, '-')}`, [label]);

  return (
    <div className="etf-grid-field">
      <div className="etf-grid-field-top">
        <label className="etf-grid-field-label" htmlFor={inputId}>
          {label}
        </label>
        {description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="etf-grid-help-btn" aria-label={`${label}说明`}>
                  <HelpCircle size={14} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-5">
                <p>{description}</p>
                {example && <p className="mt-1 opacity-80">{example}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <span className="etf-grid-input-shell">
        <input
          id={inputId}
          type={type}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          className={`input text-[16PX] etf-grid-input ${suffix ? '' : 'etf-grid-input-no-suffix'}`}
        />
        {suffix && <span className="etf-grid-input-suffix">{suffix}</span>}
      </span>
      {hint && <small className="etf-grid-field-hint">{hint}</small>}
    </div>
  );
}

function SwitchField({ label, checked, onChange, description }) {
  return (
    <div className="etf-grid-switch-field" title={description}>
      <div>
        <span>{label}</span>
        {description && <small className="etf-grid-switch-desc">{description}</small>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function AnalysisCard({ icon: Icon, title, value, desc, className = '', highlight = false }) {
  return (
    <div className={`etf-grid-analysis-card glass ${className}`}>
      <div className="etf-grid-analysis-header">
        <span className="etf-grid-analysis-icon">
          <Icon size={16} aria-hidden />
        </span>
        <span className="etf-grid-analysis-title">{title}</span>
      </div>
      <div className="etf-grid-analysis-content">
        <div className={`etf-grid-analysis-value ${highlight ? 'etf-grid-highlight' : ''}`}>{value}</div>
        {desc && <div className="etf-grid-analysis-desc">{desc}</div>}
      </div>
    </div>
  );
}

export default function EtfGridTab() {
  const customSettings = useStorageStore((s) => s.customSettings);
  const setCustomSettings = useStorageStore((s) => s.setCustomSettings);

  const storedSettings = useMemo(
    () => normalizeEtfGridSettings(customSettings?.etfGridSettings),
    [customSettings?.etfGridSettings]
  );
  const [settings, setSettings] = useState(storedSettings);
  const [historyRows, setHistoryRows] = useState(EMPTY_HISTORY);
  const [marketIndices, setMarketIndices] = useState(EMPTY_MARKET);
  const [analysisStatus, setAnalysisStatus] = useState({
    loading: false,
    error: '',
    updatedAt: ''
  });
  const analysisRequestIdRef = useRef(0);

  const fundCode = useMemo(() => getCandidateFundCode(settings), [settings]);
  const canAnalyze = fundCode.length === 6;

  const loadAnalysis = useCallback(async () => {
    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;

    if (!canAnalyze) {
      setHistoryRows(EMPTY_HISTORY);
      setMarketIndices(EMPTY_MARKET);
      setAnalysisStatus({ loading: false, error: '', updatedAt: '' });
      return;
    }

    setAnalysisStatus({ loading: true, error: '', updatedAt: '' });

    try {
      const [history, market] = await Promise.all([
        fetchFundHistory(fundCode, '3m', { netValueType: 'unit' }),
        fetchMarketIndices().catch(() => EMPTY_MARKET)
      ]);
      const nextHistoryRows = normalizeHistoryRows(history);
      const nextMarketIndices = normalizeMarketIndices(market);

      if (analysisRequestIdRef.current !== requestId) return;

      setHistoryRows(nextHistoryRows);
      setMarketIndices(nextMarketIndices);

      if (nextHistoryRows.length < ANALYSIS_MIN_POINTS) {
        setAnalysisStatus({
          loading: false,
          error: '历史净值数据不足，至少需要约 30 个交易日才能生成趋势分析。',
          updatedAt: ''
        });
        return;
      }

      setAnalysisStatus({
        loading: false,
        error: '',
        updatedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      });
    } catch {
      if (analysisRequestIdRef.current !== requestId) return;

      setHistoryRows(EMPTY_HISTORY);
      setMarketIndices(EMPTY_MARKET);
      setAnalysisStatus({
        loading: false,
        error: '行情数据暂时获取失败，请稍后重试，或检查基金代码是否正确。',
        updatedAt: ''
      });
    }
  }, [canAnalyze, fundCode]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  const analysisResult = useMemo(() => buildAnalysisResult(historyRows, marketIndices), [historyRows, marketIndices]);

  useEffect(() => {
    setSettings((prev) => (isEqual(prev, storedSettings) ? prev : storedSettings));
  }, [storedSettings]);

  const persistSettings = useCallback(
    (nextSettings) => {
      const normalized = normalizeEtfGridSettings(nextSettings);
      setSettings(normalized);
      setCustomSettings((prev) => {
        const base = isPlainObject(prev) ? prev : {};
        if (isEqual(base.etfGridSettings, normalized)) return base;
        return { ...base, etfGridSettings: normalized };
      });
    },
    [setCustomSettings]
  );

  const updateSetting = useCallback(
    (key, value) => {
      persistSettings({ ...settings, [key]: value });
    },
    [persistSettings, settings]
  );

  const result = useMemo(() => calculateEtfGrids(settings), [settings]);
  const { grids, totals } = result;

  const exportCsv = useCallback(() => {
    if (typeof document === 'undefined') return;
    const body = grids.map((grid, index) => [
      index + 1,
      grid.type,
      toFixedString(grid.gear),
      toFixedString(grid.buyPrice),
      toFixedString(grid.buyCount, 0),
      toFixedString(grid.buyAmount, 0),
      toFixedString(grid.sellPrice),
      toFixedString(grid.sellCount, 0),
      toFixedString(grid.sellAmount, 0),
      toFixedString(grid.profits, 0),
      grid.returnRate,
      toFixedString(grid.retainedProfits, 0),
      toFixedString(grid.retainedCount, 0)
    ]);
    const totalRow = [
      '总计',
      '',
      '',
      '',
      '',
      toFixedString(totals.buyAmount, 0),
      '',
      '',
      '',
      toFixedString(totals.totalProfits, 0),
      `${toFixedString(totals.totalReturnRate, 2)}%`,
      '',
      ''
    ];
    const csv = [TABLE_COLUMNS, ...body, totalRow].map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileName = settings.targetName || settings.targetCode || 'ETF';
    link.href = url;
    link.download = `${fileName}-网格交易表.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [grids, settings.targetCode, settings.targetName, totals]);

  return (
    <section className="etf-grid-tab" aria-label="ETF网格计算">
      <div className="etf-grid-header glass">
        <div className="etf-grid-heading">
          <span className="etf-grid-heading-icon">
            <Calculator size={22} aria-hidden />
          </span>
          <div>
            <h1>ETF 网格计算</h1>
            <p>{settings.targetName || settings.targetCode || '网格交易策略'}</p>
          </div>
        </div>
        <div className="etf-grid-actions">
          <button type="button" className="button secondary etf-grid-action-btn" onClick={exportCsv}>
            <Download size={16} aria-hidden />
            <span>下载表格</span>
          </button>
          <button
            type="button"
            className="button secondary etf-grid-icon-btn"
            onClick={() => persistSettings(DEFAULT_ETF_GRID_SETTINGS)}
            aria-label="重置ETF网格参数"
          >
            <RotateCcw size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="etf-grid-summary-grid">
        <div className="etf-grid-stat glass">
          <span>网格数</span>
          <strong>{grids.length}</strong>
        </div>
        <div className="etf-grid-stat glass">
          <span>预计投入</span>
          <strong>{formatNumber(totals.buyAmount, 0)}</strong>
        </div>
        <div className="etf-grid-stat glass">
          <span>预计盈利</span>
          <strong className="up">{formatNumber(totals.totalProfits, 0)}</strong>
        </div>
        <div className="etf-grid-stat glass">
          <span>收益率</span>
          <strong className="up">{toFixedString(totals.totalReturnRate, 2)}%</strong>
        </div>
        <div className="etf-grid-stat glass">
          <span>压力价</span>
          <strong>{toFixedString(totals.minPrice)}</strong>
        </div>
      </div>

      <div className="etf-grid-analysis-section">
        <div className="etf-grid-section-header">
          <h2 className="etf-grid-section-title">
            <BarChart3 size={18} aria-hidden />
            行情分析
          </h2>
          <div className="etf-grid-analysis-toolbar">
            {analysisStatus.updatedAt && <span>更新 {analysisStatus.updatedAt}</span>}
            {analysisResult && (
              <div className="etf-grid-section-suitability">
                <span className="etf-grid-suitability-label">适配性</span>
                <span
                  className={`etf-grid-suitability-score ${getSuitabilityClassName(analysisResult.suitability.score)}`}
                >
                  {analysisResult.suitability.score}分
                </span>
              </div>
            )}
            <button
              type="button"
              className="button secondary etf-grid-refresh-btn"
              onClick={loadAnalysis}
              disabled={!canAnalyze || analysisStatus.loading}
            >
              <RefreshCw className={analysisStatus.loading ? 'etf-grid-spin' : ''} size={15} aria-hidden />
              <span>刷新</span>
            </button>
          </div>
        </div>

        {!canAnalyze && (
          <div className="etf-grid-analysis-empty glass">
            <span className="etf-grid-analysis-empty-icon">
              <LineChart size={18} aria-hidden />
            </span>
            <div>
              <strong>填写 6 位基金代码后开始分析</strong>
              <span>系统会读取近 3 个月净值走势，并结合主要指数快照生成趋势和网格适配建议。</span>
            </div>
          </div>
        )}

        {canAnalyze && analysisStatus.loading && (
          <div className="etf-grid-analysis-empty glass">
            <span className="etf-grid-analysis-empty-icon">
              <RefreshCw className="etf-grid-spin" size={18} aria-hidden />
            </span>
            <div>
              <strong>正在读取行情</strong>
              <span>正在获取 {fundCode} 的净值走势和主要指数快照。</span>
            </div>
          </div>
        )}

        {canAnalyze && !analysisStatus.loading && analysisStatus.error && (
          <div className="etf-grid-analysis-empty glass">
            <span className="etf-grid-analysis-empty-icon">
              <Shield size={18} aria-hidden />
            </span>
            <div>
              <strong>暂时无法生成分析</strong>
              <span>{analysisStatus.error}</span>
            </div>
          </div>
        )}

        {analysisResult && !analysisStatus.loading && !analysisStatus.error && (
          <>
            <div className="etf-grid-analysis-grid">
              <AnalysisCard
                icon={TrendingUp}
                title="趋势"
                value={analysisResult.suitability.trend}
                desc={
                  analysisResult.ma20 && analysisResult.ma60
                    ? `MA20: ${toFixedString(analysisResult.ma20)} / MA60: ${toFixedString(analysisResult.ma60)}`
                    : `近 ${analysisResult.sampleSize} 个交易日`
                }
                highlight={analysisResult.suitability.trend === '震荡'}
              />
              <AnalysisCard
                icon={Activity}
                title="波动率"
                value={isNil(analysisResult.volatility) ? '-' : `${toFixedString(analysisResult.volatility * 100, 2)}%`}
                desc={`近20日${analysisResult.suitability.volatilityLevel}波动`}
                highlight={analysisResult.suitability.volatilityLevel === '中等'}
              />
              <AnalysisCard
                icon={Target}
                title="支撑 / 压力"
                value={`${analysisResult.support ? toFixedString(analysisResult.support) : '-'} / ${
                  analysisResult.resistance ? toFixedString(analysisResult.resistance) : '-'
                }`}
                desc={`最新净值 ${toFixedString(analysisResult.latestValue)}，${analysisResult.latestDate}`}
              />
              <AnalysisCard
                icon={LineChart}
                title="阶段表现"
                value={formatSignedPercent(analysisResult.periodReturn)}
                desc={`近 ${analysisResult.sampleSize} 个交易日累计涨跌`}
                highlight={Math.abs(analysisResult.periodReturn) <= 5}
              />
              <AnalysisCard
                icon={BarChart3}
                title="市场环境"
                value={analysisResult.market.label}
                desc={analysisResult.market.desc}
                className={`market-${getMarketToneClassName(analysisResult.market.tone)}`}
                highlight={analysisResult.market.tone === 'neutral'}
              />
              <AnalysisCard
                icon={Shield}
                title="RSI"
                value={isNil(analysisResult.rsi) ? '-' : toFixedString(analysisResult.rsi, 2)}
                desc="低于30偏弱，高于70偏热"
                highlight={!isNil(analysisResult.rsi) && analysisResult.rsi >= 35 && analysisResult.rsi <= 65}
              />
            </div>

            <div className="etf-grid-suggestion-card glass">
              <div className="etf-grid-suggestion-header">
                <LineChart size={16} aria-hidden />
                <span>分析建议</span>
              </div>
              <div className="etf-grid-suggestion-content">
                <div className="etf-grid-suggestion-main">{analysisResult.suitability.suggestion}</div>
                <ul className="etf-grid-suggestion-list">
                  {analysisResult.suitability.details.map((detail, index) => (
                    <li key={`${detail}-${index}`}>{detail}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="etf-grid-layout">
        <form className="etf-grid-settings glass" onSubmit={(event) => event.preventDefault()}>
          <div className="etf-grid-section-title">基本设置</div>
          <Field
            label="标的名称"
            type="text"
            step={undefined}
            value={settings.targetName}
            placeholder="例如：沪深300ETF"
            description="只用于页面标题和下载文件名，不参与网格计算。"
            example="可以填基金简称，也可以留空。"
            hint="用于自己识别标的，不会影响买卖价格。"
            onChange={(value) => updateSetting('targetName', value)}
          />
          <Field
            label="基金代码"
            type="text"
            step={undefined}
            value={settings.targetCode}
            placeholder="例如：510300"
            description="用于读取历史净值和主要行情快照，生成 ETF 行情分析。"
            example="填写 6 位基金代码；如果只做网格表，也可以暂时留空。"
            hint="填入代码后上方行情分析会自动刷新。"
            inputMode="numeric"
            maxLength={6}
            onChange={(value) => updateSetting('targetCode', value)}
          />
          <Field
            label="价格"
            value={settings.price}
            min="0.0001"
            step="0.0001"
            suffix="元"
            description="填你准备用来建网格的参考价格。"
            example="场内ETF通常填最新成交价；场外基金可填单位净值。"
            hint="这个价格决定每一档买入/卖出价。"
            onChange={(value) => updateSetting('price', parseFieldValue('price', value))}
          />
          <Field
            label="每份金额"
            value={settings.amount}
            min="100"
            step="100"
            suffix="元"
            description="第一格计划买入的金额。"
            example="后续每往下一小格，会按逐格加码比例逐步增加金额。"
            hint="新手可以先用较小金额试算总投入压力。"
            onChange={(value) => updateSetting('amount', parseFieldValue('amount', value))}
          />
          <Field
            label="最大跌幅"
            value={formatInputPercent(settings.maxPercentOfDecline)}
            min="5"
            max="95"
            step="1"
            suffix="%"
            description="用于压力测试最坏跌幅范围。"
            example="填60表示从当前价格一路计算到下跌60%的价格附近。"
            hint="数值越大，生成网格越多，需要准备的资金越多。"
            onChange={(value) => updateSetting('maxPercentOfDecline', parseFieldValue('maxPercentOfDecline', value))}
          />

          <div className="etf-grid-section-title">策略参数</div>
          <Field
            label="留存份数"
            value={settings.numberOfRetainedProfits}
            min="0"
            step="1"
            suffix="份"
            description="卖出时从当格盈利里保留在持仓中的份额倍数。"
            example="数值越大，卖出数量越少；新手可先用默认值2。"
            hint="用于让盈利的一部分继续留在场内。"
            onChange={(value) =>
              updateSetting('numberOfRetainedProfits', parseFieldValue('numberOfRetainedProfits', value))
            }
          />
          <Field
            label="逐格加码"
            value={formatInputPercent(settings.increasePercentPerGrid)}
            min="0"
            max="100"
            step="1"
            suffix="%"
            description="每下跌一小格，下一格买入金额增加的比例。"
            example="填5表示按10000、10500、11000这样逐格增加投入。"
            hint="看不懂时先保留默认 5%。"
            onChange={(value) =>
              updateSetting('increasePercentPerGrid', parseFieldValue('increasePercentPerGrid', value))
            }
          />
          <div className="etf-grid-switch-row">
            <SwitchField
              label="中网"
              checked={settings.hasMiddleGrid}
              description="每下跌15%额外生成一组中网。"
              onChange={(value) => updateSetting('hasMiddleGrid', value)}
            />
            <SwitchField
              label="大网"
              checked={settings.hasBigGrid}
              description="每下跌30%额外生成一组大网。"
              onChange={(value) => updateSetting('hasBigGrid', value)}
            />
          </div>

          <div className="etf-grid-beginner-note">
            <strong>新手建议</strong>
            <span>第一次使用只改基金代码、价格、每份金额、最大跌幅，其他参数先保留默认。</span>
          </div>
          <a className="etf-grid-source-link" href={ETF_GRID_SOURCE_URL} target="_blank" rel="noopener noreferrer">
            参考 hushicai/ETF
          </a>
        </form>

        <div className="etf-grid-table-card glass">
          <div className="etf-grid-table-header">
            <div>
              <h2>操作示意表</h2>
              <p>场内基金按100份整数委托修正</p>
            </div>
          </div>
          <div className="etf-grid-table-scroll">
            <table className="etf-grid-table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grids.map((grid, index) => (
                  <tr key={`${grid.type}-${grid.gear}-${index}`} className={getRowClassName(grid.type)}>
                    <td>{index + 1}</td>
                    <td>{grid.type}</td>
                    <td>{toFixedString(grid.gear)}</td>
                    <td>{toFixedString(grid.buyPrice)}</td>
                    <td>{toFixedString(grid.buyCount, 0)}</td>
                    <td>{toFixedString(grid.buyAmount, 0)}</td>
                    <td>{toFixedString(grid.sellPrice)}</td>
                    <td>{toFixedString(grid.sellCount, 0)}</td>
                    <td>{toFixedString(grid.sellAmount, 0)}</td>
                    <td>{toFixedString(grid.profits, 0)}</td>
                    <td>{grid.returnRate}</td>
                    <td>{toFixedString(grid.retainedProfits, 0)}</td>
                    <td>{toFixedString(grid.retainedCount, 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>总计</td>
                  <td colSpan={4}></td>
                  <td>{toFixedString(totals.buyAmount, 0)}</td>
                  <td colSpan={3}></td>
                  <td>{toFixedString(totals.totalProfits, 0)}</td>
                  <td>{toFixedString(totals.totalReturnRate, 2)}%</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
