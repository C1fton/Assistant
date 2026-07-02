import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { callLLM } from '@/app/lib/llmService';
import { toast } from 'sonner';

/**
 * LLM设置模态框
 */
export const LLMSettingModal = ({ open, onOpenChange }) => {
  const [apiKey, setApiKey] = useState(() =>
    typeof window === 'undefined' ? '' : window.localStorage.getItem('llm_api_key') || ''
  );
  const [baseUrl, setBaseUrl] = useState(() =>
    typeof window === 'undefined'
      ? 'https://api.openai.com/v1'
      : window.localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1'
  );
  const [model, setModel] = useState(() =>
    typeof window === 'undefined' ? 'gpt-3.5-turbo' : window.localStorage.getItem('llm_model') || 'gpt-3.5-turbo'
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSave = () => {
    setSaving(true);
    try {
      localStorage.setItem('llm_api_key', apiKey.trim());
      localStorage.setItem('llm_base_url', baseUrl.trim());
      localStorage.setItem('llm_model', model.trim());
      toast.success('LLM配置已保存');
      onOpenChange(false);
    } catch (error) {
      toast.error('保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    const nextApiKey = apiKey.trim();
    const nextBaseUrl = baseUrl.trim();
    const nextModel = model.trim();

    if (!nextApiKey || !nextBaseUrl || !nextModel) {
      toast.error('请先填写 API 密钥、API 地址和模型名称');
      return;
    }

    setTesting(true);
    try {
      const result = await callLLM(
        [
          { role: 'system', content: '你是接口连通性测试助手，只需简短回答。' },
          { role: 'user', content: '请只回复“连接成功”。' }
        ],
        {
          apiKey: nextApiKey,
          baseUrl: nextBaseUrl,
          model: nextModel,
          temperature: 0,
          maxTokens: 16
        }
      );
      toast.success(result ? `测试成功：${result}` : '测试成功');
    } catch (error) {
      toast.error('测试失败：' + (error.message || '请检查 API 配置'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="llm-settings-dialog">
        <DialogHeader>
          <DialogTitle>LLM 配置</DialogTitle>
        </DialogHeader>
        <div className="llm-settings-body">
          <div className="llm-settings-field">
            <Label className="llm-settings-label" htmlFor="apiKey">
              API 密钥
            </Label>
            <Input
              id="apiKey"
              type="password"
              className="llm-settings-input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxx"
            />
          </div>
          <div className="llm-settings-field">
            <Label className="llm-settings-label" htmlFor="baseUrl">
              API 地址
            </Label>
            <Input
              id="baseUrl"
              className="llm-settings-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="llm-settings-field">
            <Label className="llm-settings-label" htmlFor="model">
              模型
            </Label>
            <Input
              id="model"
              className="llm-settings-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="例如 gpt-4o-mini / deepseek-chat / qwen-plus"
            />
          </div>
          <div className="llm-settings-note">
            <p>支持所有 OpenAI 兼容的大模型服务，配置后即可使用智能分析功能。</p>
            <p>密钥仅保存在当前浏览器，不会同步到 Supabase，也不会上传到 GitHub Pages。</p>
          </div>
        </div>
        <DialogFooter className="llm-settings-footer">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !apiKey.trim() || !baseUrl.trim() || !model.trim()}
          >
            {testing ? '测试中...' : '测试连接'}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !apiKey.trim() || !model.trim()}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
