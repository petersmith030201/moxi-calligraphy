# 第三方资源与教材边界

本项目代码、汉字数据和用户教材分别适用各自的授权。项目根目录 MIT 许可不覆盖第三方内容，也不表示可以公开传播教材。

| 资源 | 本地用途 | 上游与许可 |
| --- | --- | --- |
| Hanzi Writer 3.7.3 | `vendor/hanzi-writer.min.js`，逐笔动画与参考字形 | [上游仓库](https://github.com/chanind/hanzi-writer)、[MIT 许可](https://github.com/chanind/hanzi-writer/blob/master/LICENSE)。库代码许可与其字形数据许可分别计算。 |
| Make Me a Hanzi 字典 | `data/characters.json`，字段取自字典并保留待核对状态 | [上游仓库](https://github.com/skishore/makemeahanzi)。字典按 LGPL-3.0-or-later；来源说明及全文见 `licenses/makemeahanzi-COPYING`、`licenses/makemeahanzi-LGPL`。 |
| Make Me a Hanzi / Arphic 图形 | `data/characters/*.json`，笔画轮廓与中线 | 图形按 Arphic Public License；详见上游 COPYING 和本地 `licenses/ARPHICPL.TXT`。它们来自开源楷体，不能称为卢中南字迹。 |
| PDF.js | `vendor/pdf.js` 与 `vendor/pdf.worker.js`，浏览器本地 PDF 渲染（官方模块仅改文件扩展名以兼容本地服务器 MIME） | [Mozilla PDF.js](https://github.com/mozilla/pdf.js)，Apache-2.0；全文见 `licenses/pdfjs-LICENSE`。 |

静态资源随站点自托管，页面不通过公共 CDN 获取库、字体或单字笔顺数据。资源中保留的上游 URL 与许可 URL 是归属信息，不表示浏览器需要访问这些 URL 才能练习。

数据整理记录（2026-11-15）：从 Make Me a Hanzi 筛选 718 字，图形仅保留笔画轮廓与中线等渲染字段，未修改路径坐标；从字典提取部首与拆分字段，并生成带来源的参考结构标签。它们仍适用上游各自许可。上游下载内容的 SHA-256 见 `data/source-manifest.json`；JSON 保持可编辑，不限制依许可修改或替换数据。

## 用户提供的三份教材

当前教材索引包括《卢中南5000常用字楷书字帖》（36 个 PDF 页面）、《卢中南教你写一手好字·笔画偏旁》（48 页）与《卢中南教你写一手好字·间架结构》（48 页），合计 132 个 PDF 页面。文件页数不等同于印刷页码。

已整理数据仅覆盖部分经过 AI 视觉核对的页面，不是整本自动学习结果，也未经书法专家审定。记录中的 `paraphrase` 是简短释义，`observation` 是版面或范例观察；练习建议、条件说明及迁移指导须与教材直接证据分开。每条摘要保留书目 ID 和 PDF 页码。

PDF 原件和页面图片不随仓库、构建产物或站点发布。用户在页面选择的 PDF 用于浏览器本地查阅；不要将教材全文、扫描图片或个人练习数据放入公共 GitHub 仓库。教材著作权与相关权利属于相应权利人，用户拥有文件副本不自动等于拥有公开发布或训练再分发的权利。公开发布教材相关数据前，应根据实际许可核对可使用范围；项目 MIT 许可不能提供教材授权。

第三方的可修改源数据应从相应上游取得，修改时保留来源与许可，不能删除其授权要求或用项目许可覆盖。后续替换资源时，应同步更新本文件及 `licenses/`。
