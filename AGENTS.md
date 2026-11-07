# qwenASR 项目协作说明

## 项目目标

本项目有两个核心能力，所有功能设计、代码改动和验证都应围绕它们展开：

1. **音频设计与合成**：使用本地 `model/Qwen3-TTS-12Hz-1.7B-VoiceDesign`，根据文本与自然语言音色描述生成高质量语音。
2. **PDF 文档解析**：使用本地 `model/MonkeyOCRv2-B-Parsing`，将 PDF（含扫描件）解析为结构化 Markdown，并保留文档阅读顺序、标题、表格、公式和图片引用。

不要将模型权重、生成音频、用户 PDF 或 OCR 产物提交到版本控制；只提交源码、配置、测试夹具和小型示例。

## 目录与模型边界

- `test_voice_design.py`：当前声音库的批量生成脚本。
- `add_voices_knowledge.py`：为“知识科普”分类追加声音的脚本。
- `voice_design/`：生成的声音库。每条声音包含 `.wav`、`_prompt.txt`、`_text.txt`，总索引为 `voice_library.csv`。
- `model/Qwen3-TTS-12Hz-1.7B-VoiceDesign/`：Qwen3-TTS VoiceDesign 本地权重；禁止修改其中的模型文件。
- `model/MonkeyOCRv2-B-Parsing/`：MonkeyOCRv2-B-Parsing 本地权重；禁止修改其中的模型文件。

创建的应用代码放在清晰的源码目录中，例如 `src/tts/`、`src/ocr/`、`scripts/` 和 `tests/`。不要继续在项目根目录堆积临时脚本。新代码必须用相对项目根目录解析路径，不能新增 `E:\\electron\\qwenASR` 这样的硬编码路径。

## 音频设计与合成

### 实现规则

- 通过 `qwen_tts.Qwen3TTSModel.from_pretrained()` 加载本地 VoiceDesign 权重，并使用 `generate_voice_design(text, language, instruct)` 生成语音。
- 沿用 `soundfile` 写出 WAV；记录采样率、时长、原始文本、语言与完整音色提示词。
- 音色提示词要描述角色/性别年龄（如需要）、音高与质感、语速、情绪、吐字、停顿和使用场景；不要只写“好听”“自然”等不可验证的词。
- 支持中文为首要语言，同时保持英文、日文、韩文等语言参数与输入文本一致。
- 新增声音时，保证 `id` 唯一，并同步写入 `voice_library.csv`，不可只生成 WAV 而缺少元数据或提示词文件。
- 批量任务应支持断点续跑：检测已有且有效的输出后跳过；不要无故覆盖用户已有音频。
- 加载模型前检查 CUDA 是否可用；在没有 GPU 或显存不足时给出可执行的报错，不要静默退化或长时间卡住。

### 验收要求

- 每个成功的任务至少输出一个可用 WAV、对应文本/提示词文件和 CSV 记录。
- 验证 WAV 可由 `soundfile.info()` 打开、采样率大于 0、时长大于 0 且无空音频。
- 试听或用基础音频检查确认：文本无明显遗漏/重复，目标语言正确，音色与提示词意图一致；批量生成时至少抽检首、中、末各一条。
- 运行现有声音库生成脚本前，先向用户说明其会使用 GPU 且可能耗时较长并产生大量音频文件。

当前可参考的本地命令（在已配置好 Qwen TTS 依赖和 CUDA 的环境中执行）：

```powershell
python test_voice_design.py
python add_voices_knowledge.py
```

## PDF → Markdown（MonkeyOCRv2-B-Parsing）

### 运行时与模型

- OCR 引擎固定为 **MonkeyOCRv2-B-Parsing**，模型路径为 `model/MonkeyOCRv2-B-Parsing`；不得擅自替换为其他 OCR 引擎。
- 当前仓库只存放 MonkeyOCR 模型权重，未包含官方文档解析运行时代码（如 `parsing/parse.py`）。在实现 OCR 功能前，先将与该模型版本匹配的官方 MonkeyOCRv2 解析代码与其依赖接入项目，并记录来源和版本。
- MonkeyOCR 文档解析环境与 Qwen TTS 环境应分开管理，避免 `torch`、`transformers`、`vllm` 和 `flash-attn` 的版本冲突。不要在未经用户同意时联网下载权重或安装大型依赖。
- 优先使用官方 `parse.py` 的批量/单文件接口，再封装为项目自己的稳定命令或 Python API；模型路径、输入路径、输出路径、GPU 设置都必须可配置。

### 输出约定

- 输入文件支持单个 PDF 和 PDF 目录；原始文件只读，绝不覆盖。
- 每份 PDF 的结果写入独立输出目录，至少包含主 Markdown、按需导出的图片/页面资源，以及结构化原始结果（若官方工具提供）。
- Markdown 必须保持页面顺序与阅读顺序；标题使用 Markdown 标题，表格使用 Markdown 表格或可追溯的 HTML 表格，公式保留 LaTex，图片使用相对路径引用。
- 输出文件使用 UTF-8；文件名安全且可复现。遇到同名文件时创建隔离目录或要求显式覆盖，不能静默覆盖已有结果。
- 对扫描件、旋转页、复杂表格、双栏排版、公式密集页和中英混排建立测试样本；低置信度或无法解析页面要在日志和 Markdown 中标注，不能伪造成功。

### 验收要求

- 对每次 OCR 任务，报告输入页数、成功/失败页数、输出 Markdown 路径和耗时。
- 检查生成 Markdown 非空，标题/段落有内容，图片链接存在；抽查首页、含表格页、含公式或图片页和末页。
- 以原 PDF 渲染页为准比对阅读顺序、关键标题、数字、表格和公式；发现错误时保留页面号与原因，便于重试或人工修订。

## 通用工程规范

- 使用 Python 3.10+，新增 Python 代码要有类型标注、清晰的错误信息和 `if __name__ == "__main__":` 入口（适用于 CLI 脚本）。
- 保持小而可测试的模块；将模型加载、输入校验、推理、文件写出和元数据生成分离。
- 运行可能消耗大量 GPU、磁盘或时间的命令前，先说明影响；不要擅自删除用户数据、模型或已有产物。
- 改动后至少做静态语法检查和与改动匹配的最小功能验证；涉及真实模型推理时，优先用一个小样本验证再启动批量任务。
