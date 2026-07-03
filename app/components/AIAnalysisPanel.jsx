import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, TrendingUp, Newspaper, AlertTriangle, RefreshCw, Settings, Loader2, History } from 'lucide-react';
import { isArray, isObject } from 'lodash';
import { storageStore, useStorageStore } from '@/app/stores/storageStore';
import { useModalStore } from '@/app/stores/modalStore';
import { callLLM, renderPrompt, PROMPT_TEMPLATES } from '@/app/lib/llmService';
import { fetchFundValuationRanking, fetchMarketSectors } from '@/app/api/fund';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

const renderInlineMarkdown = (text) => {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

const parseTableRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const MarkdownReport = ({ content }) => {
  if (!content) return null;

  const lines = String(content).split(/\r?\n/);
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.includes('|') && lines[i + 1] && isTableDivider(lines[i + 1])) {
      const headers = parseTableRow(trimmed);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      nodes.push(
        <div className="ai-report-table-wrap" key={`table-${i}`}>
          <table className="ai-report-table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={index}>{renderInlineMarkdown(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] || '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = level <= 2 ? 'h3' : 'h4';
      nodes.push(
        <Tag className={`ai-report-heading ai-report-heading-${level}`} key={`heading-${i}`}>
          {renderInlineMarkdown(headingMatch[2])}
        </Tag>
      );
      i += 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const items = [];
      while (i < lines.length) {
        const match = lines[i].trim().match(/^[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      nodes.push(
        <ul className="ai-report-list" key={`ul-${i}`}>
          {items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      const items = [];
      while (i < lines.length) {
        const match = lines[i].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      nodes.push(
        <ol className="ai-report-list ai-report-ordered" key={`ol-${i}`}>
          {items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    nodes.push(
      <p className="ai-report-paragraph" key={`p-${i}`}>
        {renderInlineMarkdown(trimmed)}
      </p>
    );
    i += 1;
  }

  return <div className="ai-report">{nodes}</div>;
};

const AnalysisResult = ({ content, emptyText = '点击按钮生成本页分析报告。' }) => {
  if (!content) {
    return <div className="ai-report-empty">{emptyText}</div>;
  }
  return <MarkdownReport content={content} />;
};

const AI_RESULT_DEFAULTS = {
  analysis: '',
  recommendation: '',
  market: '',
  risk: '',
  rebalance: '',
  review: ''
};

const AI_HISTORY_MAX = 20;

const AI_TYPE_LABELS = {
  analysis: '持仓分析',
  recommendation: '基金推荐',
  market: '市场解读',
  risk: '风险预警',
  rebalance: '调仓建议',
  review: '历史复盘'
};

const getSavedAIResults = () => {
  if (typeof window === 'undefined') return null;
  try {
    return storageStore.getItem('ai_analysis_results', null);
  } catch {
    return null;
  }
};

const getSavedAIHistory = () => {
  if (typeof window === 'undefined') return [];
  try {
    const saved = storageStore.getItem('ai_analysis_history', []);
    return isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

/**
 * 智能分析主组件
 */
export const AIAnalysisTrigger = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        className="icon-button"
        aria-label="AI智能投顾"
        onClick={() => useModalStore.setState({ aiAnalysisOpen: true })}
      >
        <Brain width="18" height="18" />
      </button>
    </TooltipTrigger>
    <TooltipContent>
      <p>AI智能投顾</p>
    </TooltipContent>
  </Tooltip>
);

export const AIAnalysisPanel = ({ open, onOpenChange }) => {
  const [activeTab, setActiveTab] = useState('analysis');
  const [loadingType, setLoadingType] = useState('');
  const [results, setResults] = useState(() => ({ ...AI_RESULT_DEFAULTS, ...(getSavedAIResults() || {}) }));
  const [history, setHistory] = useState(getSavedAIHistory);
  const [riskPreference, setRiskPreference] = useState('moderate');

  // 从store获取持仓和基金数据
  const holdings = useStorageStore((state) => state.holdings);
  const funds = useStorageStore((state) => state.funds);
  const groups = useStorageStore((state) => state.groups);

  const { data: marketSectors } = useQuery({
    queryKey: ['ai-market-sectors'],
    queryFn: fetchMarketSectors,
    enabled: !!open,
    staleTime: 120000
  });

  const { data: valuationRanking } = useQuery({
    queryKey: ['ai-valuation-ranking'],
    queryFn: () => fetchFundValuationRanking(3, 'desc', 1, 20),
    enabled: !!open,
    staleTime: 120000
  });

  useEffect(() => {
    try {
      storageStore.setItem('ai_analysis_results', JSON.stringify(results));
    } catch {
      // ignore local persistence errors
    }
  }, [results]);

  useEffect(() => {
    try {
      storageStore.setItem('ai_analysis_history', JSON.stringify(history.slice(0, AI_HISTORY_MAX)));
    } catch {
      // ignore local persistence errors
    }
  }, [history]);

  const toNumber = useCallback((value, fallback = null) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }, []);

  const getCurrentNav = useCallback(
    (fund) => {
      if (!fund) return null;
      const estimateNav = fund.noValuation ? null : toNumber(fund.gsz);
      return estimateNav ?? toNumber(fund.dwjz);
    },
    [toNumber]
  );

  const getChangePercent = useCallback(
    (fund) => {
      if (!fund) return null;
      const estimateChange = fund.noValuation ? null : toNumber(fund.gszzl);
      return estimateChange ?? toNumber(fund.zzl);
    },
    [toNumber]
  );

  const marketInsights = useMemo(() => {
    const sectorList = isArray(marketSectors) ? marketSectors : [];
    const rankingList = isArray(valuationRanking?.Data?.list) ? valuationRanking.Data.list : [];
    const fundChanges = funds
      .map((fund) => ({
        code: fund?.code,
        name: fund?.name,
        changePercent: getChangePercent(fund),
        amountHint: holdings?.[fund?.code]?.amount || null
      }))
      .filter((item) => item.changePercent != null);

    const risingFunds = fundChanges.filter((item) => item.changePercent > 0).length;
    const fallingFunds = fundChanges.filter((item) => item.changePercent < 0).length;
    const avgFundChange =
      fundChanges.length > 0
        ? fundChanges.reduce((sum, item) => sum + Number(item.changePercent || 0), 0) / fundChanges.length
        : 0;

    const sectorChanges = sectorList.filter((sector) => sector?.change_pct != null);
    const risingSectors = sectorChanges.filter((sector) => Number(sector.change_pct) > 0).length;
    const fallingSectors = sectorChanges.filter((sector) => Number(sector.change_pct) < 0).length;
    const sectorBreadth = sectorChanges.length > 0 ? risingSectors / sectorChanges.length : 0.5;
    const fundBreadth = fundChanges.length > 0 ? risingFunds / fundChanges.length : 0.5;
    const avgSectorChange =
      sectorChanges.length > 0
        ? sectorChanges.reduce((sum, sector) => sum + Number(sector.change_pct || 0), 0) / sectorChanges.length
        : 0;

    const rawScore =
      50 + avgFundChange * 7 + avgSectorChange * 5 + (sectorBreadth - 0.5) * 35 + (fundBreadth - 0.5) * 25;
    const temperatureScore = Math.max(0, Math.min(100, Math.round(rawScore)));
    const temperatureLabel = temperatureScore >= 72 ? '偏热/进攻' : temperatureScore <= 38 ? '偏冷/防守' : '中性/震荡';

    return {
      generatedAt: new Date().toLocaleString(),
      temperatureScore,
      temperatureLabel,
      breadth: {
        funds: {
          total: fundChanges.length,
          rising: risingFunds,
          falling: fallingFunds,
          avgChange: avgFundChange.toFixed(2)
        },
        sectors: {
          total: sectorChanges.length,
          rising: risingSectors,
          falling: fallingSectors,
          avgChange: avgSectorChange.toFixed(2)
        }
      },
      strongSectors: [...sectorChanges]
        .sort((a, b) => Number(b.change_pct || 0) - Number(a.change_pct || 0))
        .slice(0, 8),
      weakSectors: [...sectorChanges].sort((a, b) => Number(a.change_pct || 0) - Number(b.change_pct || 0)).slice(0, 8),
      inflowSectors: [...sectorList].sort((a, b) => Number(b.net_inflow || 0) - Number(a.net_inflow || 0)).slice(0, 8),
      valuationLeaders: rankingList.slice(0, 12)
    };
  }, [funds, getChangePercent, holdings, marketSectors, valuationRanking]);

  // 格式化持仓数据，传给LLM
  const formatHoldingsData = () => {
    const fundMap = new Map(funds.map((f) => [f.code, f]));
    const holdingList = Object.entries(holdings).map(([code, holding]) => {
      const fund = fundMap.get(code);
      const share = toNumber(holding?.share ?? holding?.shares, 0);
      const costNav = toNumber(holding?.cost);
      const currentNav = getCurrentNav(fund);
      const costAmount = share > 0 && costNav != null ? share * costNav : 0;
      const currentAmount = share > 0 && currentNav != null ? share * currentNav : toNumber(holding?.amount, 0);
      const profitAmount = currentAmount && costAmount ? currentAmount - costAmount : toNumber(holding?.profit, null);
      const profitRate = profitAmount != null && costAmount > 0 ? (profitAmount / costAmount) * 100 : null;

      return {
        code,
        name: fund?.name || '未知基金',
        type: fund?.type || '未知类型',
        holdingAmount: Number(currentAmount || 0).toFixed(2),
        holdingShares: share,
        costNav,
        currentNav,
        profitAmount: profitAmount == null ? null : Number(profitAmount.toFixed(2)),
        profitRate: profitRate == null ? null : Number(profitRate.toFixed(2)),
        estimatedChangePercent: fund?.noValuation ? null : toNumber(fund?.gszzl),
        previousDayChangePercent: toNumber(fund?.zzl),
        netValueDate: fund?.jzrq || '',
        estimateTime: fund?.gztime || fund?.time || '',
        rawTags: fund?.tags || fund?.theme || '',
        theme: fund?.theme || fund?.tags || '未知'
      };
    });

    // 计算总持仓金额和各基金占比
    const totalAmount = holdingList.reduce((sum, item) => sum + Number(item.holdingAmount || 0), 0);
    const holdingsWithRatio = holdingList.map((item) => {
      const amount = Number(item.holdingAmount || 0);
      const ratioValue = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
      const change = toNumber(item.estimatedChangePercent ?? item.previousDayChangePercent, 0);
      const tenPercentAmount = amount * 0.1;
      const onePercentPortfolio = totalAmount * 0.01;
      let actionHint = '持有观察';

      if (ratioValue >= 18 && Math.abs(change) >= 2) {
        actionHint = '高占比且波动较大，优先控制仓位，不宜追涨杀跌';
      } else if (change <= -3 && ratioValue <= 10) {
        actionHint = '小占比急跌，可评估分批低吸，单次不超过组合总额 1%';
      } else if (change <= -3 && ratioValue > 10) {
        actionHint = '已有一定仓位且急跌，优先暂停补仓，等待企稳信号';
      } else if (change >= 3 && item.profitRate != null && item.profitRate >= 12) {
        actionHint = '涨幅和盈利较高，可评估分批止盈 10%-20%';
      } else if (change >= 2 && ratioValue < 6) {
        actionHint = '小占比走强，可观察是否补到目标仓位';
      }

      return {
        ...item,
        ratioValue: Number(ratioValue.toFixed(2)),
        ratio: totalAmount > 0 ? ratioValue.toFixed(2) + '%' : '0%',
        decisionHints: {
          actionHint,
          portfolioOnePercentAmount: Number(onePercentPortfolio.toFixed(2)),
          fundTenPercentAmount: Number(tenPercentAmount.toFixed(2)),
          maxSingleActionSuggestion:
            totalAmount > 0
              ? '单只基金单日动作建议优先控制在组合总额 1%-3%，高波动基金更低'
              : '缺少组合总额，建议只输出仓位百分比'
        }
      };
    });

    const concentration = holdingsWithRatio
      .map((item) => ({ code: item.code, name: item.name, ratio: item.ratio, amount: item.holdingAmount }))
      .sort((a, b) => Number.parseFloat(b.ratio) - Number.parseFloat(a.ratio));

    const buildExposure = (key) => {
      const grouped = holdingsWithRatio.reduce((acc, item) => {
        const label = String(item[key] || '未知');
        acc[label] = (acc[label] || 0) + Number(item.holdingAmount || 0);
        return acc;
      }, {});
      return Object.entries(grouped)
        .map(([label, amount]) => ({
          label,
          amount: Number(amount.toFixed(2)),
          ratio: totalAmount > 0 ? Number(((amount / totalAmount) * 100).toFixed(2)) : 0
        }))
        .sort((a, b) => b.amount - a.amount);
    };

    const topRatio = concentration[0] ? Number.parseFloat(concentration[0].ratio) : 0;
    const top3Ratio = concentration.slice(0, 3).reduce((sum, item) => sum + Number.parseFloat(item.ratio || '0'), 0);

    return JSON.stringify(
      {
        source: '当前页面本地持仓 + 当前已加载基金估值/净值数据',
        generatedAt: new Date().toLocaleString(),
        totalAmount: Number(totalAmount.toFixed(2)),
        fundCount: holdingList.length,
        groupCount: groups.length,
        exposureSummary: {
          topFundRatio: Number(topRatio.toFixed(2)),
          top3FundRatio: Number(top3Ratio.toFixed(2)),
          concentrationLevel:
            topRatio >= 25 || top3Ratio >= 55 ? '高集中' : topRatio >= 15 || top3Ratio >= 40 ? '中等集中' : '分散',
          typeExposure: buildExposure('type'),
          themeExposure: buildExposure('theme')
        },
        topConcentration: concentration.slice(0, 8),
        holdings: holdingsWithRatio
      },
      null,
      2
    );
  };

  // 基于当前页面已有基金数据生成市场/组合快照
  const getMarketData = () => {
    const fundSnapshot = funds.map((fund) => {
      const changePercent = getChangePercent(fund);
      return {
        code: fund?.code,
        name: fund?.name,
        currentNav: getCurrentNav(fund),
        estimatedChangePercent: fund?.noValuation ? null : toNumber(fund?.gszzl),
        previousDayChangePercent: toNumber(fund?.zzl),
        changePercent,
        netValueDate: fund?.jzrq || '',
        estimateTime: fund?.gztime || fund?.time || '',
        noValuation: !!fund?.noValuation,
        theme: fund?.theme || fund?.tags || ''
      };
    });

    const changedFunds = fundSnapshot.filter((item) => item.changePercent != null);
    const topRisers = [...changedFunds].sort((a, b) => b.changePercent - a.changePercent).slice(0, 8);
    const topFallers = [...changedFunds].sort((a, b) => a.changePercent - b.changePercent).slice(0, 8);
    const highVolatility = [...changedFunds]
      .filter((item) => Math.abs(item.changePercent) >= 2)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 10);

    return JSON.stringify(
      {
        source: '当前页面已加载基金估值/净值数据 + 行情页板块/估值榜静态兜底数据；不含外部新闻抓取',
        generatedAt: new Date().toLocaleString(),
        marketTemperature: marketInsights,
        fundCount: funds.length,
        valuedFundCount: changedFunds.length,
        risingCount: changedFunds.filter((item) => item.changePercent > 0).length,
        fallingCount: changedFunds.filter((item) => item.changePercent < 0).length,
        noValuationCount: fundSnapshot.filter((item) => item.noValuation).length,
        topRisers,
        topFallers,
        highVolatility,
        allFunds: fundSnapshot.slice(0, 80)
      },
      null,
      2
    );
  };

  const formatHistoryData = () => {
    return JSON.stringify(
      {
        source: '用户本地保存的 AI 分析记录，仅用于复盘此前建议，不代表建议已执行。',
        generatedAt: new Date().toLocaleString(),
        historyCount: history.length,
        recentHistory: history.slice(0, 10).map((item) => ({
          type: item.type,
          typeLabel: item.typeLabel,
          generatedAt: item.generatedAt,
          snapshot: item.snapshot,
          contentExcerpt: String(item.content || '').slice(0, 2200)
        }))
      },
      null,
      2
    );
  };

  const saveHistoryRecord = (type, content) => {
    const record = {
      id: `${Date.now()}-${type}`,
      type,
      typeLabel: AI_TYPE_LABELS[type] || type,
      generatedAt: new Date().toLocaleString(),
      snapshot: {
        fundCount: funds.length,
        holdingCount: Object.keys(isObject(holdings) ? holdings : {}).length,
        marketTemperature: marketInsights.temperatureLabel,
        marketTemperatureScore: marketInsights.temperatureScore
      },
      content
    };
    setHistory((prev) => [record, ...(isArray(prev) ? prev : [])].slice(0, AI_HISTORY_MAX));
  };

  // 执行分析
  const handleAnalyze = async (type) => {
    const apiKey = storageStore.getItem('llm_api_key');
    if (!apiKey) {
      toast.error('请先配置LLM API密钥');
      useModalStore.setState({ llmSettingOpen: true });
      return;
    }

    setLoadingType(type);

    try {
      const holdingsData = formatHoldingsData();
      const marketData = getMarketData();
      const historyData = formatHistoryData();
      let prompt;

      switch (type) {
        case 'analysis':
          prompt = renderPrompt(PROMPT_TEMPLATES.holdingAnalysis, { holdingsData });
          break;
        case 'recommendation':
          prompt = renderPrompt(PROMPT_TEMPLATES.fundRecommendation, {
            holdingsData,
            riskPreference:
              riskPreference === 'conservative'
                ? '保守型：追求稳健收益，风险承受能力低'
                : riskPreference === 'moderate'
                  ? '平衡型：追求收益和风险平衡，风险承受能力中等'
                  : '激进型：追求高收益，能承受较大波动'
          });
          break;
        case 'market':
          prompt = renderPrompt(PROMPT_TEMPLATES.marketAnalysis, { marketData });
          break;
        case 'risk':
          prompt = renderPrompt(PROMPT_TEMPLATES.riskWarning, { holdingsData, marketData });
          break;
        case 'rebalance':
          prompt = renderPrompt(PROMPT_TEMPLATES.rebalanceAdvice, { holdingsData, marketData });
          break;
        case 'review':
          prompt = renderPrompt(PROMPT_TEMPLATES.historyReview, { holdingsData, marketData, historyData });
          break;
        default:
          throw new Error('不支持的分析类型');
      }

      const response = await callLLM([
        {
          role: 'system',
          content:
            '你是专业的基金投资分析助手。必须基于输入数据给出逐基金、可执行、条件化的操作建议；不要承诺收益，不要编造输入中没有的数据。'
        },
        { role: 'user', content: prompt }
      ]);

      setResults((prev) => ({ ...prev, [type]: response }));
      saveHistoryRecord(type, response);
    } catch (error) {
      toast.error('分析失败: ' + error.message);
    } finally {
      setLoadingType('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>AI智能投顾</span>
            <Button variant="ghost" size="sm" onClick={() => useModalStore.setState({ llmSettingOpen: true })}>
              <Settings className="h-4 w-4 mr-2" />
              配置
            </Button>
          </DialogTitle>
          <DialogDescription>基于你的持仓数据和最新市场情况，提供专业的投资分析和建议</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-6 mb-4">
            <TabsTrigger value="analysis" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">持仓分析</span>
            </TabsTrigger>
            <TabsTrigger value="recommendation" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">基金推荐</span>
            </TabsTrigger>
            <TabsTrigger value="market" className="flex items-center gap-2">
              <Newspaper className="h-4 w-4" />
              <span className="hidden sm:inline">市场解读</span>
            </TabsTrigger>
            <TabsTrigger value="risk" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">风险预警</span>
            </TabsTrigger>
            <TabsTrigger value="rebalance" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">调仓建议</span>
            </TabsTrigger>
            <TabsTrigger value="review" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">复盘</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="analysis" className="h-full mt-0">
              <div className="ai-analysis-card">
                <div className="ai-analysis-card-header">
                  <h3 className="ai-analysis-card-title">持仓智能分析</h3>
                  <p className="ai-analysis-card-description">全面分析你的持仓结构、风险分散情况、行业集中度等</p>
                </div>
                <div className="ai-analysis-card-content">
                  <Button onClick={() => handleAnalyze('analysis')} disabled={!!loadingType} className="mb-4">
                    {loadingType === 'analysis' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    开始分析
                  </Button>
                  <AnalysisResult content={results.analysis} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="recommendation" className="h-full mt-0">
              <div className="ai-analysis-card">
                <div className="ai-analysis-card-header">
                  <h3 className="ai-analysis-card-title">个性化基金推荐</h3>
                  <p className="ai-analysis-card-description">根据你的风险偏好和当前持仓，推荐合适的优质基金</p>
                </div>
                <div className="ai-analysis-card-content">
                  <div className="mb-4 flex items-center gap-4">
                    <label className="text-sm font-medium">风险偏好:</label>
                    <Select value={riskPreference} onValueChange={setRiskPreference}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conservative">保守型</SelectItem>
                        <SelectItem value="moderate">平衡型</SelectItem>
                        <SelectItem value="aggressive">激进型</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => handleAnalyze('recommendation')} disabled={!!loadingType} className="mb-4">
                    {loadingType === 'recommendation' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    获取推荐
                  </Button>
                  <AnalysisResult content={results.recommendation} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="market" className="h-full mt-0">
              <div className="ai-analysis-card">
                <div className="ai-analysis-card-header">
                  <h3 className="ai-analysis-card-title">市场热点解读</h3>
                  <p className="ai-analysis-card-description">结合最新行情和新闻，分析市场趋势，给出操作建议</p>
                </div>
                <div className="ai-analysis-card-content">
                  <Button onClick={() => handleAnalyze('market')} disabled={!!loadingType} className="mb-4">
                    {loadingType === 'market' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    查看分析
                  </Button>
                  <AnalysisResult content={results.market} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="risk" className="h-full mt-0">
              <div className="ai-analysis-card">
                <div className="ai-analysis-card-header">
                  <h3 className="ai-analysis-card-title">风险预警</h3>
                  <p className="ai-analysis-card-description">排查持仓潜在风险，提前提示利空消息和大幅波动风险</p>
                </div>
                <div className="ai-analysis-card-content">
                  <Button onClick={() => handleAnalyze('risk')} disabled={!!loadingType} className="mb-4">
                    {loadingType === 'risk' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    风险检测
                  </Button>
                  <AnalysisResult content={results.risk} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="rebalance" className="h-full mt-0">
              <div className="ai-analysis-card">
                <div className="ai-analysis-card-header">
                  <h3 className="ai-analysis-card-title">调仓建议</h3>
                  <p className="ai-analysis-card-description">输出逐基金、可量化、带触发条件的加仓/减仓/持有方案</p>
                </div>
                <div className="ai-analysis-card-content">
                  <Button onClick={() => handleAnalyze('rebalance')} disabled={!!loadingType} className="mb-4">
                    {loadingType === 'rebalance' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    获取建议
                  </Button>
                  <AnalysisResult content={results.rebalance} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="review" className="h-full mt-0">
              <div className="ai-analysis-card">
                <div className="ai-analysis-card-header">
                  <h3 className="ai-analysis-card-title">历史复盘</h3>
                  <p className="ai-analysis-card-description">保存每次 AI 建议，并结合当前组合与市场温度复盘此前判断</p>
                </div>
                <div className="ai-analysis-card-content">
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Button onClick={() => handleAnalyze('review')} disabled={!!loadingType || history.length === 0}>
                      {loadingType === 'review' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      生成复盘
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={history.length === 0 || !!loadingType}
                      onClick={() => setHistory([])}
                    >
                      清空历史
                    </Button>
                  </div>
                  <AnalysisResult
                    content={results.review}
                    emptyText="生成过 AI 分析后，这里会保存历史记录并支持复盘。"
                  />
                  <div className="ai-history-list">
                    {history.length === 0 ? (
                      <div className="ai-report-empty">暂无历史建议。先在其他页签生成一次分析。</div>
                    ) : (
                      history.slice(0, 8).map((item) => (
                        <details className="ai-history-item" key={item.id}>
                          <summary>
                            <span>{item.typeLabel}</span>
                            <span>{item.generatedAt}</span>
                            <span>
                              {item.snapshot?.marketTemperature || '市场温度未知'}
                              {item.snapshot?.marketTemperatureScore != null
                                ? ` ${item.snapshot.marketTemperatureScore}`
                                : ''}
                            </span>
                          </summary>
                          <MarkdownReport content={item.content} />
                        </details>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
