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
  const [apiKey, setApiKey] = useState(localStorage.getItem('llm_api_key') || '');
  const [baseUrl, setBaseUrl] = useState(localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1');
  const [model, setModel] = useState(localStorage.getItem('llm_model') || 'gpt-3.5-turbo');
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>LLM智能服务配置</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="apiKey">API 密钥</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxx"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="baseUrl">API 地址</Label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model">选择模型</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="model">
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
          <div className="text-sm text-muted-foreground">
            <p>支持所有 OpenAI 兼容的大模型服务，配置后即可使用智能分析功能。</p>
            <p className="mt-1">密钥仅存储在本地浏览器中，不会上传到任何服务器。</p>
          </div>
        </div>
        <DialogFooter>
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
