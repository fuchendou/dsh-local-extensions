<div align="center"><a name="readme-top"></a>

<img src="./public/hero.png" alt="安装插件" />

# DSH Office Kit

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

为 DeepSeek Harness (DSH) 提供本地 Word、PDF、演示文稿与电子表格能力，支持 `/` 菜单、引用 Chip，以及侧边栏预览中的选区标注与修改请求。
</div>

## 📦 安装

在官方插件中安装 `dsh-office-kit`

<img src="https://raw.githubusercontent.com/hairyf/dsh-office-kit/refs/heads/main/public/install.png" alt="安装插件" />

或使用命令行安装

```sh
dsh plugin add dsh-office-kit
```

- 在 **设置 → 插件** 中启用。
- 需要 DSH ≥ `0.2.1-rc.2` 和 Python `3.10`–`3.13`；本地适配版不会自动安装 Python 或依赖。
- 按部署文档准备独立虚拟环境；配置和虚拟环境位于当前 `DSH_HOME/office`。

## 特性

- 📝 **Word**：`/documents` 创建、读取和编辑 DOCX，支持表格、图片、公式与页眉页脚。
- 📄 **PDF**：`/pdf` 创建、读取和编辑 PDF，支持合并、旋转、删页与元数据。
- 📽️ **演示文稿**：`/presentations` 创建、读取和编辑 PPTX，支持项目符号、表格、图表与图片。
- 📊 **电子表格**：`/spreadsheets` 创建、读取和编辑 XLSX，支持公式、样式、图表、冻结窗格与重算。
- 🖍️ **侧边栏标注**：在 PDF、DOC/DOCX、PPTX、XLSX 预览中吸附段落或框选区域，批量提交修改要求。
- 🔗 **会话引用**：通过 Chip 调用文档技能；注释链接可悬停查看文件名与要求，PDF 标注附选区截图。
- 🖼️ **渲染校验**：DOCX/PPTX/XLSX 经 DeepSeek Harness 自带的 LibreOffice Kit（Windows/macOS 原生引擎，Linux 走 WASM）栅格化，PDF 直接用 PyMuPDF；缺失字体会在报告里点名，不再静默产出豆腐块。SVG/PDF 素材可用 `ensure_raster_image.py` 转成 PNG 后嵌入。
- 🧮 **活体表格**：`excel-live-control` 技能通过 COM 驱动已经打开的 Excel / WPS 表格（读区、写值、样式、图表、重算、保存）。

## 🚀 快速开始

### 通过菜单处理文档

<img src="https://raw.githubusercontent.com/hairyf/dsh-office-kit/refs/heads/main/public/image.png" alt="Office 菜单与文档预览" />

1. 在输入框键入 `/`，选择 **文档**、**PDF 文档**、**演示文稿** 或 **电子表格**。
2. 回车插入 Chip，描述创建、读取或修改任务。
3. 打开生成的文件，在侧边栏预览结果。


### 在预览中请求修改

| <img src="https://raw.githubusercontent.com/hairyf/dsh-office-kit/refs/heads/main/public/annotation-selection.png" alt="段落吸附与修改要求输入" /> | <img src="https://raw.githubusercontent.com/hairyf/dsh-office-kit/refs/heads/main/public/annotation-conversation.png" alt="注释列表与会话引用" /> |
| ------------- | ------------- |

1. 打开 PDF 或 DOC/DOCX，点击工具栏的 **请求修改**。
2. 悬停吸附段落，点击或拖动框选，输入要求并添加注释。
3. 悬停底部 **注释数量** 查看列表，点击 **发送**；**取消** 清空本批。

- **Esc**：先取消当前选区，再按一次退出标注模式。
- **附件**：PDF 附选区截图；DOC/DOCX 仅发送文字与定位信息。
- **草稿**：已有输入时先合入草稿，由你确认发送；暂存注释刷新后不保留。

## 💡 示例文档

- [Word](<public/samples/sample.docx>)
- [PDF](<public/samples/sample.pdf>)
- [演示文稿](<public/samples/sample.pptx>)
- [电子表格](<public/samples/sample.xlsx>)
- [来源与许可](<public/samples/README.md>)

## 📚 配置与限制

- **Python**：`DSH_OFFICE_PYTHON` 可指定解释器。
- **标注范围**：仅 PDF、DOC/DOCX；扫描 PDF 可框选截图，不提供 OCR。
- **本地文件**：不支持 Google Docs / Slides / Sheets 或远程编辑。
- **完整清单**：[能力与未支持项](<CAPABILITY.md>)。

## 🛠️ 开发与贡献

```sh
pnpm install
pnpm run lint --fix
pnpm run typecheck
pnpm run test -- --run
pnpm run build
```

## 📜️ 许可证

- [MIT](<LICENSE.md>)
- 示例文档保留 [Apache Tika 的许可与声明](<public/samples/README.md>)。

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/dsh-office-kit?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/dsh-office-kit
[npm-downloads-src]: https://img.shields.io/npm/dm/dsh-office-kit?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/dsh-office-kit
[bundle-src]: https://img.shields.io/bundlephobia/minzip/dsh-office-kit?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=dsh-office-kit
[license-src]: https://img.shields.io/github/license/hairyf/dsh-office-kit.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/hairyf/dsh-office-kit/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/dsh-office-kit
