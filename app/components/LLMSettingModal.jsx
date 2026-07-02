import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

  const handleSave = () => {
    setSaving(true);
    try {
      localStorage.setItem('llm_api_key', apiKey.trim());
      localStorage.setItem('llm_base_url', baseUrl.trim());
      localStorage.setItem('llm_model', model);
      toast.success('LLM配置已保存');
      onOpenChange(false);
    } catch (error) {
      toast.error('保存失败: ' + error.message);
    } finally {
      setSaving(false);
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
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="model" className="llm-settings-input">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5-turbo</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="deepseek-chat">DeepSeek Chat</SelectItem>
                <SelectItem value="moonshot-v1-8k">Moonshot V1 8K</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="llm-settings-note">
            <p>支持所有 OpenAI 兼容的大模型服务，配置后即可使用智能分析功能。</p>
            <p>密钥仅保存在当前浏览器，不会同步到 Supabase，也不会上传到 GitHub Pages。</p>
          </div>
        </div>
        <DialogFooter className="llm-settings-footer">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !apiKey.trim()}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
