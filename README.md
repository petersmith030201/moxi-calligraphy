# 墨习 · 字帖书法教学原型

这是一个可部署到 GitHub Pages 的硬笔楷书学习原型：查询汉字，逐笔观察开源参考字形，检索教材摘要与出处，在本地查阅对应 PDF，并进行临写与结构比较。它把教材证据、概括和 AI 推演分别呈现。

当前使用的三份教材合计 **132 个 PDF 页面**：常用字字帖 36 页、笔画偏旁 48 页、间架结构 48 页。仅部分页面经过 AI 视觉核对，未经过书法专家审定。书名中的“5000”是原教材名称，不表示软件已识别 5000 字、已完整索引全书或已支持所有汉字。笔顺覆盖范围以随站点发布的数据为准。

## 现阶段边界

- 本项目按硬笔楷书语境处理这些教材，不据此声称已学习毛笔笔锋和真实用力。
- 动画字形来自 Make Me a Hanzi / Arphic 开源数据，**不是卢中南真迹**。书法家范字须查阅用户自己的教材。
- 教材卡片是有页码的简短释义或页面观察。`reviewed` 表示 AI 已看过相应扫描页面，不表示专家认可结论。练习建议与迁移推演不应冒充作者原文。
- 本地写字、照片比较只能辅助观察形态；不等于专业书法评分，不可从单张照片断言实际运笔力度、速度或笔锋。
- GitHub Pages 只托管静态前端。AI 对话还需要单独部署 `worker/` 服务并配置模型 API，本仓库交付本身不代表 AI 服务已部署或完成端到端联调。

## 本地运行

使用 Node.js 22 或更新版本以及 Python 3。无需 npm 安装第三方前端包，静态库和字形数据已经自托管。

在仓库目录执行：

```powershell
node --test tests/static.test.mjs tests/worker.test.mjs
node tools/build-static.mjs
python -m http.server 8000 --directory dist
```

可选的12项 DOM 交互测试需要仅用于开发的 jsdom 26.1.0；可在独立测试目录安装并通过 `MOXI_TEST_DEPS` 指定路径，具体命令见 `tests/frontend.test.mjs` 文件开头。没有依赖时该组会显式跳过。DOM 模拟验证导航、引用、表单和画板操作逻辑，不能替代真实浏览器布局、SVG 动画、触控和画板像素验证。

然后打开 `http://localhost:8000`。不要通过 `file://` 双击 HTML，浏览器模块和 JSON 加载需要 HTTP 服务。

构建只复制 `index.html`、`styles.css`、`app.js`、`pdf-local.js`、`data/`、`vendor/` 与 `licenses/`。它会检查输入、清理本项目内经过路径验证的 `dist/`，再重新生成产物，支持重复构建。允许树内发现 PDF、图片、凭据文件、已知密钥格式或符号链接时会拒绝构建。该检查用于减少误发布，不能替代提交前检查。

## PDF 与个人数据

教材原件不在仓库和 `dist/` 中。选择 PDF 后，由浏览器中的 PDF.js 本地渲染；刷新或关闭页面后可能需要重新选择文件。书目中的 SHA-256 用于匹配教材版本，不代表任何教材授权。页面引用按 PDF 页序（从 1 起）定位，印刷页码另列。

不要在公共仓库中保存教材、页面截图、练习照片、API 密钥或本地数据库。清除浏览器站点数据可能移除本地学习记录；需要长期保存时应先自行备份。启用远程 AI 后，浏览器会把提问、查询汉字和所选规则 ID 发送给配置的服务；服务再将相关摘要与问题交给模型。PDF、照片和画板轨迹不在此接口的请求中。服务的日志、保留策略和访问控制需由部署者另外配置。

## GitHub Pages 部署

建议仓库为 `petersmith030201/moxi-calligraphy`。这是建议名称，本说明不表示远程仓库已经创建或站点已经发布。

1. 将本目录作为仓库根目录提交到 GitHub，默认分支使用 `main`。先检查提交清单中没有 PDF、照片、密钥及 `dist/`。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 推送到 `main`，或在 Actions 手动运行 **Deploy calligraphy site**。工作流先验证数据并构建，只上传 `dist/`，随后部署到 `github-pages` 环境。
4. 部署成功后的 URL 以 Actions 输出为准。若采用上述用户名与仓库名，通常形如 `https://petersmith030201.github.io/moxi-calligraphy/`。

工作流使用 GitHub 官方 Actions，部署阶段仅授予 Pages 写入和 OIDC 权限，不需要把个人访问令牌或模型 API 密钥写入前端。参考 [GitHub Pages 自定义工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 和 [官方静态站点工作流](https://github.com/actions/starter-workflows/blob/main/pages/static.yml)。

## 配置 AI 服务

依据 `worker/` 内的实际部署说明配置模型网关、服务器端 API 密钥和访问控制，再将服务地址填入页面 AI 设置。模型密钥只保存在服务端的 secret store，不写进 HTML、JavaScript、JSON、GitHub Pages 或公开仓库。

应先用无敏感信息的问题验证连通性和引用约束，再启用真实学习会话。AI 必须只使用检索得到的证据 ID 引用教材；无证据时说明缺少直接依据，将迁移建议标成推演，不生成虚构的书页、原文或作者结论。当前仓库不承诺服务端已配置、调用成功或推演已由教师验证。

## 目录与授权

`data/` 保存书目、摘要和汉字数据；`vendor/` 保存本地前端库；`licenses/` 保存第三方许可；`worker/` 是独立服务端；`tools/build-static.mjs` 生成发布白名单；`tests/` 检查数据与静态交付边界。

原创代码使用根目录 MIT 许可。第三方库、笔顺字形、字典与教材分别适用独立条款，详见 [THIRD_PARTY.md](THIRD_PARTY.md) 与 `licenses/`。代码开源不等于教材内容可公开再分发。
