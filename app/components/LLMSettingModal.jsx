import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { callLLM, LLM_PROVIDERS } from '@/app/lib/llmService';
import { storageStore } from '@/app/stores/storageStore';
import { toast } from 'sonner';

const getSavedLLMValue = (key, fallback = '') => {
  if (typeof window === 'undefined') return fallback;
  try {
    return storageStore.getItem(key, fallback) || fallback;
  } catch {
    return fallback;
  }
};

/**
 * LLM设置模态框
 */
export const LLMSettingModal = ({ open, onOpenChange }) => {
  const [provider, setProvider] = useState(() => getSavedLLMValue('llm_provider', 'openai'));
  const [apiKey, setApiKey] = useState(() => getSavedLLMValue('llm_api_key', ''));
  const [baseUrl, setBaseUrl] = useState(() => getSavedLLMValue('llm_base_url', LLM_PROVIDERS.openai.defaultBaseUrl));
  const [model, setModel] = useState(() => getSavedLLMValue('llm_model', LLM_PROVIDERS.openai.defaultModel));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleProviderChange = (nextProvider) => {
    const previousDefaults = LLM_PROVIDERS[provider] || LLM_PROVIDERS.openai;
    const nextDefaults = LLM_PROVIDERS[nextProvider] || LLM_PROVIDERS.openai;

    setProvider(nextProvider);
    if (!baseUrl.trim() || baseUrl.trim() === previousDefaults.defaultBaseUrl) {
      setBaseUrl(nextDefaults.defaultBaseUrl);
    }
    if (!model.trim() || model.trim() === previousDefaults.defaultModel) {
      setModel(nextDefaults.defaultModel);
    }
  };

  const handleSave = () => {
    setSaving(true);
    try {
      storageStore.setItem('llm_provider', provider);
      storageStore.setItem('llm_api_key', apiKey.trim());
      storageStore.setItem('llm_base_url', baseUrl.trim());
      storageStore.setItem('llm_model', model.trim());
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
          provider,
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
            <Label className="llm-settings-label" htmlFor="provider">
              服务商
            </Label>
            <select
              id="provider"
              className="llm-settings-input llm-settings-select"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic Claude</option>
            </select>
          </div>
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
              placeholder="https://api.openai.com/v1 或 https://ark.cn-beijing.volces.com/api/coding/v3"
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
              placeholder={
                provider === 'anthropic'
                  ? '例如 claude-3-5-sonnet-latest / claude-3-haiku-20240307'
                  : '例如 gpt-4o-mini / deepseek-chat / qwen-plus / ark-code-latest'
              }
            />
          </div>
          <div className="llm-settings-note">
            <p>
              {provider === 'anthropic'
                ? 'Anthropic 模式使用 /v1/messages、x-api-key 与 anthropic-version 请求 Claude。'
                : 'OpenAI 兼容模式优先使用 /chat/completions，并会对火山 Ark Coding 等服务自动尝试兼容参数。API 地址填服务商提供的 base URL，通常不需要手动加 /chat/completions。'}
            </p>
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
