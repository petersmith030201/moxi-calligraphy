# 第三方资源与数据来源

项目代码、字典、笔画图形与界面字体分别适用各自的授权。根目录 MIT 许可不替代第三方条款，也不授权用户教材的复制或公开传播。数据快照的来源与 SHA-256 见 `data/source-manifest.json`。

| 资源 | 新版用途与发布位置 | 上游与许可 |
| --- | --- | --- |
| Hanzi Writer 3.7.3 | `vendor/hanzi-writer.min.js`，笔顺与参考字形展示 | [上游仓库](https://github.com/chanind/hanzi-writer)，MIT。全文见 `licenses/hanzi-writer-LICENSE`。库许可与其加载的字形数据许可分别计算。 |
| Make Me a Hanzi 字典 | `data/characters.json` 中的来源字段、部首、IDS 等参考资料 | [上游仓库](https://github.com/skishore/makemeahanzi)，字典按 LGPL-3.0-or-later。来源说明及全文见 `licenses/makemeahanzi-COPYING`、`licenses/makemeahanzi-LGPL`。 |
| Make Me a Hanzi / Arphic 图形 | `data/characters/*.json`，笔画 SVG 轮廓与中线 | 图形按 Arphic Public License；见上游 COPYING 与本地 `licenses/ARPHICPL.TXT`。数据来源说明另保留于 `licenses/hanzi-writer-COPYING.md`。 |
| CNChar 3.2.6 整字笔画类型 | `data/stroke-types.json`，8776 字的类型与歧义候选，用于自动汇总相关笔记；不对应动画序号 | [上游仓库](https://github.com/theajack/cnchar)、[笔顺名称文档](https://theajack.github.io/cnchar/doc/order.html)，MIT；全文见 `licenses/Cnchar-MIT.txt`。来源版本、包与许可证 SHA-256、转换及覆盖范围记录在数据文件中。未打包 CNChar 运行时。 |
| CNChar 3.2.6 有限逐笔名称 | `data/stroke-names.json`，25 个常用字的有限核对参考，仅供单笔状态显示 | 与上一行相同的上游和 MIT 许可。此名称序列表与整字类型表分别制备，不能互相代替其覆盖声明。 |
| Moxi Book Serif | `vendor/fonts/moxi-book-serif.woff2`，界面标题与阅读排版 | 由 Adobe [思源宋体 Source Han Serif](https://github.com/adobe-fonts/source-han-serif) CN 字体制成的派生子集，依 SIL Open Font License 1.1 发布；全文见 `licenses/Moxi-Book-Serif-OFL.txt`。 |

Moxi Book Serif 于 **2026-11-15** 为本项目制备子集，并重命名为 **Moxi Book Serif**。修改包含字形子集化、WOFF2 转换及派生字体名称调整；制备脚本为 `tools/subset-ui-font.py`。界面字体仅用于排版，不是书法家的真迹，也不替代逐笔数据。

## 字形数据与个人修订

本次可用图形与元数据相配，共 9574 条字形记录，简体与繁体按各自字符保存。此数字不表示收录全部汉字、异体写法或所有地区规范。上游字形来自开源楷体，不得称为卢中南或其他书法家的真实字迹。

部首与 IDS 是结构参考，不能保证等同于每一种教学拆分，也不包含书法布局的精确比例。未知偏旁与待核对分类应保持可见。用户修订与手工笔记是独立个人资料，不应覆盖来源标记或被表述为上游事实；个人 JSON 备份不包含上述字典及笔顺图形。

CNChar 名称数据与 Make Me a Hanzi 轨迹为独立来源。`tools/prepare-stroke-types.mjs` 制备的整字类型表覆盖当前 9574 字中的 8776 字，798 字无可用参考并保持未知；类型列表不经过逐笔顺序对齐，也不用于判断具体横画的长短。源编码对应多个名称时，保留多种候选并用 `ambiguousTypes` 标记，不表示候选一定同时存在于该字中；“点2”只归并为检索标签“点”，不认证其实际形态一致。

`tools/prepare-stroke-names.mjs` 制备的有限名称序列表只为 25 个常用字提供核对参考。不能将两库笔画数量相同视为所有笔序和名称完全一致的证明；源名称有歧义或无法确认对应的项目保留空值。它仅服务于单笔观察状态，不限制整字类型检索。两种名称资源都不用于声称某位书家采用特定笔法。

## 可选 AI 结果

`ai.js` 是本项目的浏览器接口代码，通过用户配置的 HTTPS、Chat Completions 兼容服务分析间架结构。模型名称、调用地址和密钥可随时切换，只保留于页面内存，不作为静态发布资源或个人备份内容。请求不发送笔记或 PDF，只发送当前汉字及部首、拆字和结构参考字段。第三方服务的费用、数据处理及输出使用条款由所选服务决定；服务端需允许跨域调用（CORS），本站不提供模型代理或共享密钥。

AI 结果是独立标记的推演参考，不是教材引文、PDF 页码证据或上游字典事实，不覆盖个人修订，不作为书家真实风格的证明。

所有静态运行资源自托管。上游仓库、许可和来源 URL 是归属与查阅链接，不表示页面须通过公共 CDN 加载资源。修改或再分发第三方内容时，应保留其许可与声明，并满足对应源数据条款；项目 MIT 许可不能覆盖这些要求。

## 旧版文件

仓库与 `v0.1` 标签中保留先前教材摘要、书目、PDF.js、本地 PDF 查阅代码和可选 Worker 接口，便于恢复旧版。它们不进入新版静态构建白名单。`licenses/pdfjs-LICENSE` 随完整许可目录保留，仅用于记录旧版 PDF.js 的 Apache-2.0 许可，并不表示新版加载 PDF.js。

用户提供的教材原件与页面图片不随仓库或站点发布。旧版摘要仅涉及部分经过 AI 视觉核对的页面，未经书法专家审定，不能据其声称已完整学习教材。原教材及相关权利属于相应权利人；用户拥有副本不自动获得公开传播或再分发授权。保留旧源码也不改变这些边界。
