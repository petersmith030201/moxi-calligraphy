# 可选大模型教学接口

此接口尚未部署，尚未使用真实供应商密钥联调。静态网页可独立使用。需要 Node.js 22+、Wrangler 4.36+、你自己的 Cloudflare 账号和大模型 API 账号。支持返回 `choices[0].message.content` 的 Chat Completions 兼容接口；并非所有供应商均可不经适配直接使用。

1. 在项目 `worker` 目录用官方 Wrangler 工具部署；第一次需要由你完成 Cloudflare 登录。
2. 设置服务端 `AI_ENDPOINT`（完整 HTTPS 请求地址）、`AI_MODEL`。支持 JSON 输出模式时保持 `JSON_MODE=true`，否则可设 false，模型仍须返回 JSON。
3. 使用 `wrangler secret put AI_API_KEY` 设置供应商密钥，使用 `wrangler secret put ACCESS_TOKEN` 设置独立的教学接口访问码。不要把真实值写入配置文件或发到聊天。
4. 检查 `ALLOWED_ORIGINS` 只含你的网页来源；本地调试按需另加 `http://localhost:4173`。允许来源不是身份认证，本接口另以访问码鉴权。
5. 部署后在网页“我的 → AI教学接口”填写 Worker 服务根地址及接口访问码。访问码仅在当前网页会话内保存。网页不接收供应商密钥。

请求：`POST /teach`，正文 `{character,question,ruleIds}`；请求头 `Authorization: Bearer <接口访问码>`。最多10个已核对规则，问题不超过800字符。服务器使用自己打包的教材摘要，拒绝浏览器传入的伪造规则ID。PDF、照片和画板轨迹都不发送。

返回的教材依据文本由服务端按允许规则ID回填，模型生成内容仅作为迁移建议或证据缺口展示。此校验不能证明建议在书法上正确，需要继续核查语义及适用条件。

配置包含每分钟6次的近似限流（Cloudflare各位置分别计算，不能视为硬性总预算），每次限制输出长度。请另在所选模型供应商控制台设置可用的额度/预算限制。Worker、模型服务的收费和数据留存政策由各供应商决定。

执行 `node --test tests/worker.test.mjs`（在项目根目录）运行模拟上游的鉴权、来源、伪造引用与错误处理测试。这些测试不等于真实模型联调。
