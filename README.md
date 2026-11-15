# 墨习 · 查字与书写笔记

墨习是可部署到 GitHub Pages 的汉字学习工具。本版围绕查字、笔顺、部首部件与结构资料、个人修订，以及可复用的手工笔记展开。页面和笔顺数据自托管，个人资料在当前浏览器中保存，可通过 JSON 导入与导出。

本版不提供 PDF 导入、AI 对话或临摹画板入口。旧版教材摘要、PDF 渲染代码与模型接口仍保留在仓库历史和相应源文件中，但不进入新版站点构建。

## 数据与学习边界

- 本次数据快照含 **9574 条汉字记录**及对应笔画图形，包含简体和繁体。这是当前数据集覆盖量，不表示覆盖全部汉字、所有异体字或所有地区的笔顺规范；实际数字以 `data/source-manifest.json` 和页面统计为准。
- 笔顺与参考字形取自 Make Me a Hanzi / Arphic 开源数据，不是某位书法家的真迹。单字是否可演示取决于本地数据是否包含它，软件不会用模型或普通字体补造缺失笔顺。
- 部首、IDS 拆分与结构分类是参考资料。IDS 描述部件组合关系，不能完整表达书法教学中的间架结构、疏密、位置与精确比例；含未知部件或尚未核对的项目会保留其不确定性。
- 用户可以记录自己的部首、部件与结构修订。修订属于个人资料，不会改写或冒充上游字库事实。个人笔记也不是经过专家审定的教学结论。
- 界面宋体仅用于标题与阅读排版，不能作为书法家的真实范字。

## 使用与保存

在查字页输入一个汉字，查看基础资料、田字格参考和逐笔演示；结合笔画观察，把自己确认过的结构或部件修订保存到本地。手工笔记可在相关汉字、部件或结构的学习中复用，使用时仍需判断适用条件。

个人修订与笔记不会自动云同步，也不会因 GitHub Pages 发布更新而写入 GitHub 仓库。它们与浏览器、设备和站点来源有关，换浏览器、换域名或清除站点数据后不会自动出现。新版使用独立存储，保留旧版本的浏览器数据，不自动清除或覆盖旧记录。

需要跨设备或长期保存时，使用页面的 JSON 导出功能下载个人备份，再在目标浏览器导入。导入前先导出已有资料，并核对导入结果。个人备份包含应用的个人资料，**不包含笔顺图形和整套字典**；重新运行页面时仍需要站点自带的数据文件。不要把私人笔记或备份提交到公共仓库。

## 本地运行

需要 Node.js 24 或更新版本。前端没有需要安装的 npm 运行时依赖，Hanzi Writer、字形和界面字体均随站点自托管。

在仓库根目录执行：

```powershell
node --test tests/model.test.mjs tests/store.test.mjs tests/static.test.mjs
node tools/build-static.mjs
node tools/dev-server.mjs
```

打开 `http://127.0.0.1:4173`。可用 `node tools/dev-server.mjs --port 8000` 更换端口。开发服务器仅监听本机，提供 `dist/` 中的文件，并为 JavaScript、JSON、CSS 和 WOFF2 返回相应 MIME 类型；用 `Ctrl+C` 停止。

也可用 `python -m http.server 8000 --directory dist` 提供静态服务；若系统将 `.js` 识别为非 JavaScript MIME，请改用上述 Node 预览器。不要通过 `file://` 双击 HTML，模块和 JSON 加载需要 HTTP 服务。

`npm test`、`npm run build`、`npm run preview` 分别对应上述测试、构建和预览步骤。旧版 Worker 的测试保留在仓库，但不是本版发布门禁。

可选的 DOM 交互测试使用 jsdom 26.1.0，可在独立开发目录安装并通过 `MOXI_TEST_DEPS` 指定位置，再运行 `npm run test:ui`。它执行实际页面、应用及数据模块，覆盖笔记原文复用、修订、导入冲突、存储失败和真实笔顺库的 SVG 创建。缺少依赖时会明确跳过；这类测试不能替代真实浏览器的布局、动画帧和触控验证。

## 构建范围

发布白名单仅包括：

- `index.html`、`styles.css`、`app.js`、`model.js`，以及存在时的 `store.js`。
- `data/characters.json`、`data/source-manifest.json` 和 `data/characters/` 中逐字 JSON。
- `vendor/hanzi-writer.min.js`、`vendor/fonts/moxi-book-serif.woff2` 和 `licenses/`。

构建不会原样复制整个 `data/` 或 `vendor/`。教材摘要、书目、PDF.js、`pdf-local.js` 和 `worker/` 留在源码目录中，不进入 `dist/`。构建先检查输入，再安全重建本项目的 `dist/`，以免旧文件残留；发布资产总大小限制为 50 MB。允许树内的 PDF、图片、符号链接、凭据文件和常见密钥内容会使构建失败；检查不能代替提交前审阅。

静态测试核对所有字形与元数据的一一对应、SVG 路径与笔画中线、来源许可、无远程静态依赖及旧载荷隔离，也验证重复构建和污染输入拒绝。数据一致性检查不能证明每个汉字的教学分类或地区笔顺均正确。

## GitHub Pages

本仓库面向 `petersmith030201/moxi-calligraphy`，默认分支为 `main`。在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

推送到 `main` 或手动运行 **Deploy calligraphy site** 后，工作流使用 Node.js 24 运行本版模型与静态测试，只上传 `dist/`，随后部署到 `github-pages` 环境。站点地址以 Actions 的成功部署输出为准，通常为 `https://petersmith030201.github.io/moxi-calligraphy/`。

工作流只给构建阶段仓库只读权限，给部署阶段 Pages 与 OIDC 所需权限。新版没有模型 API，因此无需配置模型密钥。参考 [GitHub Pages 自定义工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 恢复旧版与授权

旧版源码已保留在 Git 标签 `v0.1`。需要单独查看时，可在干净目录运行 `git worktree add ../moxi-v0.1 v0.1` 创建独立旧版工作目录。恢复旧版代码不会自动迁移新版资料，也不要通过清除浏览器存储来切换版本。

原创代码适用根目录 MIT 许可；第三方库、字典、图形、界面字体及旧版教材分别适用独立条款。来源与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)、`data/source-manifest.json` 与 `licenses/`。代码开源不等于教材可公开再分发。
