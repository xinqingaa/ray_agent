---
name: preset-ppt
description: 制作 PPT / 演示稿工作流：对齐主题与大纲，生成应用内可翻页 HTML 预览稿并支持导出与中文核验。
---

# 制作 PPT / 演示稿工作流

先对齐结构、再做可翻页演示稿预览、最后按需导出共享文件，保证版式克制、重点突出、中文导出完整无缺字。

## 阶段流

1. **材料与目标对齐**：
   - 若用户附带了 PDF/DOCX/XLSX/PPTX 等参考材料，先用 `read_document` 通读提炼核心论点；
   - 若未说明页数或受众，默认按 8–10 页、面向团队/管理层汇报口径起手，并先给出每页「页标题 + 一句话核心观点」短大纲（必要时快速确认后再全量生成）。
2. **制作可翻页 HTML 演示稿（默认优先交付）**：
   - 遵循预加载的视觉规范（必要时通过 `read_skill_resource` 读 `presentation-design` 的 `references/visual-checklist.md` 及本包 `references/slide-patterns.md`）；
   - 生成单个自包含 HTML 演示稿（支持左右键/按钮翻页、页码跳转与 `@media print` 横版打印样式），写入工作区或会话目录后调用 `register_preview` 登记应用内预览，并调用 `deliver_files` 交付；
   - 后续用户要求修改某一页时，先 `read_file` 原 HTML 做局部修订，保留其余页面不变。
3. **按需导出 `.pptx` 或 `.pdf`**：
   - 若用户明确需要 `.pptx` 或 `.pdf`，用随包 Python 生成（优先使用 macOS 原生中文字体 `PingFang SC` / `Hiragino Sans GB` / `Songti SC`，若在会话 `scratch` 临时装包生成 PDF 则务必嵌入字体或通过浏览器打印导出）；
   - **导出核验（必做）**：调用 `verification-critique` 的 `scripts/verify_office.py` 检查结构；导出 `.pdf` 时**必须**再调用 `read_document` 核对中文文本可完整提取、无乱码方块。

## 反模式红线

- **禁止一页塞满大段文字**：每页只讲 1 个核心判断，要点控制在 3–5 条短句内，用对比表、指标卡或流程图替代大段粘贴。
- **禁止跳过应用内预览直接只丢半成品代码**：HTML 演示稿必须 `register_preview` 登记预览并 `deliver_files` 交付。
- **禁止未验文本提取就声称中文 PDF 没问题**：不能只看生成命令返回码 0，必须通过 `read_document` 验证中文字形与内容完整可提取。
- **禁止假数据充数**：缺失的指标或案例明确标为「占位 / 待确认」。
