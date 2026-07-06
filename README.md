# Assistant

Assistant 是一个基金估值、持仓追踪和 AI 辅助分析工具，基于 [hzm0321/real-time-fund](https://github.com/hzm0321/real-time-fund) 二次开发。

## 功能

- 实时基金估值、净值和涨跌幅展示
- 基金重仓股、关联板块和市场行情追踪
- 持仓、交易记录、定投计划、本地备份和 Supabase 云同步
- GitHub Pages 静态部署
- OpenAI 兼容与 Anthropic Claude 兼容的 LLM 配置
- AI 持仓分析、市场解读、风险预警和调仓建议

## 本地开发

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

## 构建

```bash
npm run build
```

静态文件会生成在 `out/`。

## 环境变量

复制 `env.example` 为 `.env.local`，按需配置：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY`
- `NEXT_PUBLIC_GA_ID`
- `NEXT_PUBLIC_GITHUB_LATEST_RELEASE_URL`
- `NEXT_PUBLIC_IS_GITHUB_LOGIN`

## LLM 配置

在网页中的 LLM 配置弹窗填写：

- OpenAI 兼容：例如 OpenAI、DeepSeek、通义千问、OpenRouter、火山 Ark Coding
- Anthropic Claude：使用 Anthropic Messages API

API Key 仅保存在当前浏览器本地，不会同步到 Supabase，也不会上传到 GitHub Pages。

## 免责声明

本项目所有数据来自公开接口或用户自行配置的数据源，仅供个人学习和参考，不构成任何投资建议。

## License

本项目基于原项目协议，采用 AGPL-3.0。
