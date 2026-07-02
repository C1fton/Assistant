import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, TrendingUp, Newspaper, AlertTriangle, RefreshCw, Settings, Loader2 } from 'lucide-react';
import { useStorageStore } from '@/app/stores/storageStore';
import { callLLM, renderPrompt, PROMPT_TEMPLATES } from '@/app/lib/llmService';
import { LLMSettingModal } from './LLMSettingModal';
import { toast } from 'sonner';

/**
 * 智能分析主组件
 */
export const AIAnalysisPanel = () => {
  const [open, setOpen] = useState(false);
  const [settingOpen, setSettingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('analysis');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [riskPreference, setRiskPreference] = useState('moderate');

  // 从store获取持仓和基金数据
  const holdings = useStorageStore((state) => state.holdings);
  const funds = useStorageStore((state) => state.funds);
  const groups = useStorageStore((state) => state.groups);

  // 格式化持仓数据，传给LLM
  const formatHoldingsData = () => {
    const fundMap = new Map(funds.map((f) => [f.code, f]));
    const holdingList = Object.entries(holdings).map(([code, holding]) => {
      const fund = fundMap.get(code);
      return {
        code,
        name: fund?.name || '未知基金',
        type: fund?.type || '未知类型',
        holdingAmount: holding.amount || 0,
        holdingShares: holding.shares || 0,
        costPrice: holding.cost || 0,
        currentPrice: fund?.dwjz || 0,
        profit: holding.profit || 0,
        profitRate: holding.profitRate || 0,
        theme: fund?.theme || '未知'
      };
    });

    // 计算总持仓金额和各基金占比
    const totalAmount = holdingList.reduce((sum, item) => sum + item.holdingAmount, 0);
    const holdingsWithRatio = holdingList.map((item) => ({
      ...item,
      ratio: totalAmount > 0 ? ((item.holdingAmount / totalAmount) * 100).toFixed(2) + '%' : '0%'
    }));

    return JSON.stringify(
      {
        totalAmount,
        fundCount: holdingList.length,
        groupCount: groups.length,
        holdings: holdingsWithRatio
      },
      null,
      2
    );
  };

  // 获取模拟市场数据（后续可以接入真实的市场行情API）
  const getMarketData = () => {
    return JSON.stringify(
      {
        date: new Date().toLocaleDateString(),
        shIndex: '3200.56',
        shChange: '+1.23%',
        szIndex: '11800.34',
        szChange: '+0.87%',
        cyIndex: '2450.78',
        cyChange: '+1.56%',
        hotSectors: ['AI人工智能', '半导体', '新能源', '医药生物', '消费'],
        fallingSectors: ['房地产', '金融', '煤炭'],
        marketNews: [
          '央行降准0.5个百分点，释放长期资金约1万亿元',
          'AI大模型应用加速落地，相关产业链受益',
          '新能源行业产能出清，龙头企业估值修复',
          '医药集采政策边际改善，创新药板块反弹'
        ]
      },
      null,
      2
    );
  };

  // 执行分析
  const handleAnalyze = async (type) => {
    const apiKey = localStorage.getItem('llm_api_key');
    if (!apiKey) {
      toast.error('请先配置LLM API密钥');
      setSettingOpen(true);
      return;
    }

    setLoading(true);
    setResult('');

    try {
      const holdingsData = formatHoldingsData();
      const marketData = getMarketData();
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
        default:
          throw new Error('不支持的分析类型');
      }

      const response = await callLLM([
        { role: 'system', content: '你是专业的基金投资分析助手，回答要专业、客观、实用，避免空泛的建议。' },
        { role: 'user', content: prompt }
      ]);

      setResult(response);
    } catch (error) {
      toast.error('分析失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* 入口按钮 */}
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="flex items-center gap-2">
        <Brain className="h-4 w-4" />
        <span>AI智能分析</span>
      </Button>

      {/* 分析模态框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>AI智能投顾</span>
              <Button variant="ghost" size="sm" onClick={() => setSettingOpen(true)}>
                <Settings className="h-4 w-4 mr-2" />
                配置
              </Button>
            </DialogTitle>
            <DialogDescription>基于你的持仓数据和最新市场情况，提供专业的投资分析和建议</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid grid-cols-5 mb-4">
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
            </TabsList>

            <div className="flex-1 overflow-y-auto">
              <TabsContent value="analysis" className="h-full mt-0">
                <div className="ai-analysis-card">
                  <div className="ai-analysis-card-header">
                    <h3 className="ai-analysis-card-title">持仓智能分析</h3>
                    <p className="ai-analysis-card-description">全面分析你的持仓结构、风险分散情况、行业集中度等</p>
                  </div>
                  <div className="ai-analysis-card-content">
                    <Button onClick={() => handleAnalyze('analysis')} disabled={loading} className="mb-4">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      开始分析
                    </Button>
                    {result && activeTab === 'analysis' && (
                      <div className="p-4 bg-muted rounded-lg whitespace-pre-line text-sm">{result}</div>
                    )}
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
                    <Button onClick={() => handleAnalyze('recommendation')} disabled={loading} className="mb-4">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      获取推荐
                    </Button>
                    {result && activeTab === 'recommendation' && (
                      <div className="p-4 bg-muted rounded-lg whitespace-pre-line text-sm">{result}</div>
                    )}
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
                    <Button onClick={() => handleAnalyze('market')} disabled={loading} className="mb-4">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      查看分析
                    </Button>
                    {result && activeTab === 'market' && (
                      <div className="p-4 bg-muted rounded-lg whitespace-pre-line text-sm">{result}</div>
                    )}
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
                    <Button onClick={() => handleAnalyze('risk')} disabled={loading} className="mb-4">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      风险检测
                    </Button>
                    {result && activeTab === 'risk' && (
                      <div className="p-4 bg-muted rounded-lg whitespace-pre-line text-sm">{result}</div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="rebalance" className="h-full mt-0">
                <div className="ai-analysis-card">
                  <div className="ai-analysis-card-header">
                    <h3 className="ai-analysis-card-title">调仓建议</h3>
                    <p className="ai-analysis-card-description">根据当前市场情况和持仓结构，给出具体的调仓优化建议</p>
                  </div>
                  <div className="ai-analysis-card-content">
                    <Button onClick={() => handleAnalyze('rebalance')} disabled={loading} className="mb-4">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      获取建议
                    </Button>
                    {result && activeTab === 'rebalance' && (
                      <div className="p-4 bg-muted rounded-lg whitespace-pre-line text-sm">{result}</div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <LLMSettingModal open={settingOpen} onOpenChange={setSettingOpen} />
    </>
  );
};
