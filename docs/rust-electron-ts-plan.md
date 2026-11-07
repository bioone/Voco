# Rust + Electron + TypeScript：实施与测试方案

准备日期：2026-11-07。当前阶段仅准备分支、官方测试素材和方案；尚未实现或验证 Rust 模型推理。

## 1. 分支与旧版保留

- 原目录只有空的 `.git`，没有可继承的提交或远程配置。本轮初始化了本地 Git。
- `legacy/electron-python`：现有源码基线，提交 `0e3fd5b`。
- `feature/rust-electron-ts`：从上述基线创建的新开发分支。
- 当前 GitHub 连接的可访问仓库中未找到对应的 `qwenASR`；没有创建远程仓库或推送。若后续提供原仓库地址，先比较历史和源码再确定如何接入，不能直接覆盖现有文件。
- 初始基线使用仅此次提交有效的 `Codex <codex@local.invalid>` 身份；未设置用户的全局 Git 身份。
- 旧软件包保留在 `release/win-unpacked/`，不重打包、不覆盖。模型、虚拟环境、声音库、用户输入和输出均不纳入 Git。
- 原目录已有的 `.tmp_*.py` 与 `.impeccable/` 本地文件保持原样，未纳入本次源码基线。

完整旧包基线见 [legacy-package-manifest.json](legacy-package-manifest.json)：106 个文件，共 385702052 字节，逐文件记录相对路径、大小和 SHA-256，覆盖 `resources/app/`、Python 后端、配置、运行库和 EXE。后续验收必须比较完整文件集合（含新增/缺失文件），不能只检查 EXE；Electron 的应用代码变化并不会改变 EXE 哈希。

旧 EXE 的补充校验值：

```text
文件：release/win-unpacked/qwenASR.exe
字节：245726208
SHA-256：49b61a030a520fc36a4b8fa5cce53fb4e935a7bdbbe4b80e9222f598e49cc7fa
```

## 2. 交付范围与产品边界

新分支保留现有工作台交互，逐步把 Electron 主进程、preload 和 React 界面迁移到 TypeScript；ASR 改为 Rust + Candle，直接加载本地 `model/Qwen3-ASR-0.6B`。优先实现音视频导入、CPU/CUDA/自动模式、任务进度、取消、结果与字幕导出。

现有 TTS 与声音库可沿用已有 Python 后端；它们属于可选能力，缺少 TTS 环境不能阻止新版 ASR 启动。无需为 ASR 安装 Python。PDF/MonkeyOCR 不在这次迁移范围内。

视频内容总结列为后续独立里程碑：基于转写文本调用另一个本地文本模型，生成摘要、主要观点与章节。ASR 模型不承担通用总结；本地尚未选定总结模型及运行时。理解 PPT、图表、无解说画面需要独立视觉处理，不能把纯转写摘要标为完整画面理解。

## 3. 技术选择

### 推理与设备

首选验证社区库 [qwen3-asr 0.2.2](https://docs.rs/qwen3-asr/0.2.2/qwen3_asr/)，对应 [alan890104/qwen3-asr-rs](https://github.com/alan890104/qwen3-asr-rs)。其配置使用 Candle 0.9.2，并提供 safetensors 加载与设备参数。它不是 Qwen 官方推理实现，必须通过下面的真实样本验收。

实施时提交 `Cargo.lock`，记录实际采用的版本及源码来源；本轮未添加依赖。先验证本机 Rust/MSVC/CUDA 编译兼容性，再决定是否需要升级项目工具链，不直接更改全局环境。

| 设置 | 规定行为 |
| --- | --- |
| `cpu` | 启动 CPU worker，明确报告实际设备；不尝试 CUDA。 |
| `cuda` | 启动 CUDA worker，检查 GPU 编号、模型加载与推理；失败直接报错，不静默切换。 |
| `auto` | 优先尝试 CUDA。初始化/依赖不可用时报告原因，再启动 CPU；输入损坏等与设备无关的错误不得被误当作回退理由。 |

GPU 显存不足需要单独错误码。自动模式可以在完整释放 GPU 进程后按既定策略重新运行 CPU，但必须显示回退，不拼接失败 GPU 任务的残留结果。CPU 使用兼容精度，GPU 精度依据模型与设备支持选择；记录实际精度并对照识别结果。

Candle 的 `cuda` 是编译 feature，运行时设备选择不能补上未编译的 CUDA 后端。当前依赖还涉及 CUDA 动态库，第一版采用独立 CPU/CUDA worker，防止 CUDA DLL 加载失败阻止整个应用启动。参考 [Candle CUDA 构建说明](https://huggingface.github.io/candle/guide/installation.html) 与 [Candle 0.9.2 依赖配置](https://docs.rs/crate/candle-core/0.9.2/source/Cargo.toml)。

### 应用与进程职责

```text
React + TypeScript
        │ 受限、类型化的 preload API
Electron + TypeScript：设置、文件选择、队列、历史、取消、导出
        │ JSON Lines 请求与事件
        ├── Rust CPU worker ──┐
        └── Rust CUDA worker ─┴── 内置 FFmpeg → 音频分段 → Qwen3-ASR
        └── 现有 Python TTS worker（单独配置的可选功能）
```

- Electron 管理任务状态与进程生命周期，Rust 管理输入转换、模型推理及该任务的结果文件。
- 保留现有 `progress`、`result`、`error` JSONL 事件约定；新增协议版本、实际设备、警告和阶段字段。版本字段对 Rust worker 强制校验；现有 Python TTS 继续经独立适配器按原协议接入，不能因缺少版本字段被误拒绝。Rust stdout 只输出协议，日志走 stderr。
- 成功必须同时满足有效 `result`、退出码为 0、输出文件校验通过；不能看到一条日志就判成功。
- 取消要终止 Rust 与其 FFmpeg 子进程；收到关闭事件前不释放串行任务槽。应用重启把未完成任务标为中断，重试使用新任务目录。
- TypeScript 共享类型不能代替运行时 IPC/文件路径校验。保留 `contextIsolation`、sandbox、CSP 和固定 preload API。

### 媒体、输出与字幕

- 同包包含 FFmpeg 和所需运行库；开发时可以显式指定已安装的 FFmpeg。发布包不依赖全局 PATH。
- 通过参数数组启动进程，不拼接 shell 命令。输入原文件只读；输出写入唯一任务目录，不覆盖用户文件。
- 用 FFmpeg 解码为 16 kHz、单声道 PCM；优先在静音边界分段，设置长度与资源上限。长文件逐段读取，不能一次把整个视频解码到内存。
- 结果包含 TXT、JSON、可选 Markdown、SRT/VTT；JSON 记录源文件、实际设备、模型标识、采样率、时长、语言、耗时、分段时间、警告和输出路径。
- 第一阶段字幕采用真实片段起止时间，明确标为“片段时间”。不能把它描述成逐字精确对齐。
- 精确字幕需要接入并验证本地 `Qwen3-ForcedAligner-0.6B`，列为独立门槛；不要根据字数平均分摊时间并冒充模型对齐。
- 多音轨视频必须有可见的音轨选择/默认说明；无音轨、损坏文件、静音、部分片段无识别结果分别处理，不伪造完整成功。

### 旧版与新版隔离

新包采用独立应用名和 `userData`，不得复用旧版的 `studio-state.json`。新版默认输出根目录也与旧版区分；读取旧声音库可以只读复用。

新包写到 `release/rust-electron-ts-<version>-<timestamp>/`；先完整构建 staging，再验证并发布目录。不调用会更新旧 unpacked 包的脚本。支持从其他工作目录启动、移动软件目录后重新选择外部模型；ASR 不依赖原项目位置。

## 4. 实施顺序与完成条件

| 阶段 | 主要工作 | 完成条件 |
| --- | --- | --- |
| P0（本轮） | 本地分支、官方素材、旧版测试基线、实施与测试方案 | 分支可查；素材校验通过；明确已测与未测项。 |
| P1 | `src-rust/`、设备选择、权重校验、单音频推理、JSONL CLI | CPU/CUDA 构建；官方中英样本真实转写；错误与取消测试通过。先短样本再长任务。 |
| P2 | FFmpeg 视频/音频输入、分段、结果与片段字幕、资源限制 | 官方音频派生视频、跨段样本、损坏输入、路径与输出完整性测试通过。 |
| P3 | Electron/React 迁移 TS/TSX，共享类型、设置、任务与导出接入 | TS 严格检查、现有回归、真实 Electron IPC/界面测试通过。 |
| P4 | 独立应用数据、CPU/CUDA 双 worker 与 FFmpeg 分发 | 新 unpacked 包从其他 cwd 启动；可选择外部权重；旧包完整文件集合、大小及哈希不变；打包真实转写通过。 |
| P5 | 可选精确对齐、文本总结 | 为各自模型/运行时建立单独验收。缺少依赖时明确不可用，不显示已完成功能。 |

主要文件改动集中在 `src-rust/`、`src/electron/`、`src/renderer/`、未来的 `src/shared/`、`scripts/` 与 `tests/`。TS 迁移保留预加载产物为 CJS；不同时重写 OCR/TTS 模型实现。

## 5. 官方测试素材

清单在 [manifest.json](../tests/fixtures/qwen3-asr/manifest.json)，下载与校验入口在 [prepare-asr-fixtures.cjs](../scripts/prepare-asr-fixtures.cjs)。音频缓存放在被 Git 忽略的 `outputs/test-fixtures/qwen3-asr/`，普通单测不联网。

```powershell
# 已准备好缓存；默认只做离线校验
node scripts/prepare-asr-fixtures.cjs

# 另一台开发机需要素材时，显式下载缺失的两个小样本
node scripts/prepare-asr-fixtures.cjs --download

# 样本工具测试，以及现有工作台回归
node --test tests/asr-fixtures.test.cjs
npm test
```

已存在且有效的缓存会跳过下载；已存在但损坏的文件会报错并保留，不自动覆盖。下载内容先验证大小、哈希和 WAV 元数据，再独占发布完整文件。

固定来源为 QwenLM/Qwen3-ASR 提交 `7c6daf77a2421100f5fb066495372c00129d39ff`：

- [官方 Transformers 推理示例](https://github.com/QwenLM/Qwen3-ASR/blob/7c6daf77a2421100f5fb066495372c00129d39ff/examples/example_qwen3_asr_transformers.py)
- [官方对齐示例及给定中英文本](https://github.com/QwenLM/Qwen3-ASR/blob/7c6daf77a2421100f5fb066495372c00129d39ff/examples/example_qwen3_forced_aligner.py)

| 样本 | 格式 | 时长 | 用途 |
| --- | --- | --- | --- |
| `asr_zh.wav` | 16 kHz、单声道、PCM16 | 4.2039375 秒 | 中文识别、内容完整性、最小 GPU 冒烟。 |
| `asr_en.wav` | 48 kHz、单声道、PCM24 | 15.051229166666667 秒 | 英文识别、重采样与位深转换。 |

中文参考为“甚至出现交易几乎停滞的情况。”。中英参考文本来自官方 ForcedAligner 的给定输入，不代表官方保证每个 ASR 后端逐字输出相同。不得把本次模型输出回填为参考答案。

这两条素材用于冒烟与回归，不足以代表复杂噪声、方言、多人重叠、长视频的总体识别质量。后续扩展素材必须继续标注来源、参考文本依据和许可情况；不自动把用户私有录音纳入版本控制。

## 6. 测试矩阵与准入规则

| 层级 | 覆盖内容 | 验收证据 |
| --- | --- | --- |
| 素材完整性 | 哈希、字节数、WAV 结构、采样格式、帧数、时长；损坏/空文件拒绝 | 离线校验结果与负例测试。 |
| 静态/单元 | TS 严格类型、Rust fmt/clippy/test；路径、协议、设备策略、字幕格式、任务状态 | 命令、退出码、通过/失败/跳过数量。 |
| FFmpeg 集成 | 48k PCM24 转 16k PCM16；MP4/MKV 音轨；无音轨、损坏文件、中文/空格路径 | 输出可解码、时长差不超过 50ms、采样率/声道正确。 |
| 真实 ASR | 中英 × CPU/CUDA × 自动/指定语言 | 原始输出、规范化文本、CER/WER、实际设备与精度、加载/推理耗时、资源峰值。 |
| 分段/故障 | 官方音频拼接跨 30 秒边界；静音；错误 GPU ID；OOM；取消和进程崩溃 | 无片段丢失/重复、时间单调且不越界、错误明确、不提交成功产物。 |
| Electron | 真窗口、preload/IPC、设置持久化、视频选择、结果/字幕导出、取消重试 | 实际应用结果与截图；模拟 worker 仅用于错误路径，不能代替真实推理。 |
| 打包 | 软件移位、无关 cwd、外部权重、FFmpeg/DLL 完整、CPU 独立启动、旧版隔离 | 真正 unpacked EXE 测试、依赖清单、完整旧包 manifest 前后比较。 |
| 可选对齐/总结 | 精确时间戳；长文分段总结、来源时间引用、无依据内容检查 | 各自单独报告，不混入 ASR 通过数。 |

### 准确性门槛（项目标准，不是官方标准）

1. 使用固定规范化：Unicode NFKC、统一英文大小写/撇号、去标点；中文 CER 按字，英文 WER 按词。保留原始输出供人工核对；数字、否定词和实际内容不得在规范化时删除。
2. 官方中文短句规范化 CER = 0；官方英文 WER ≤ 0.15。英文保留参考中的语气词，不能为通过测试临时删除。
3. 两个样本均检查语言、非空、完整结束、无截断警告；CPU 与 CUDA 分别满足参考门槛，并单独报告两者差异。
4. CPU/CUDA 不要求二进制输出或浮点值相同。若文本存在内容差异，保留差异并调查，不以“GPU 更快”跳过正确性。
5. 性能先记录本机冷加载和连续三次热运行的中位数；本轮不预设未经测量的实时倍率，不引用他人 Apple GPU 数字充当 RTX 3060 实测。
6. 任何门槛失败都保留报告并查因。修改门槛必须说明数据/需求依据，不能自动降标准或把失败测试改为跳过。

### 派生样本与环境故障

用官方 WAV 加静态画面产生视频测试夹具，并记录生成命令、输入哈希与输出参数。它是“官方音频派生视频”，不是“官方视频示例”。跨段样本记录每段预期偏移和插入静音时长。

明确测试无效 GPU ID 与 CUDA worker 启动失败；仅删除 PATH 或隐藏某个 DLL 不能证明真实无驱动机器兼容。若没有无 NVIDIA 环境，报告该项尚未实机验证，不得假报通过。不得为测试卸载用户驱动或改动系统 CUDA。

## 7. 当前环境与准备阶段记录

| 项目 | 当前观察 | 尚需验证 |
| --- | --- | --- |
| GPU | RTX 3060，12288 MiB，驱动 617.42 | Candle 真实加载、算子兼容、推理显存。 |
| CUDA Toolkit | nvcc 12.8 | MSVC/CUDA/Rust 联合构建与随包 DLL。 |
| Rust | rustc/cargo 1.85.0，stable 工具链 | 与选定依赖的最低版本兼容；必要时项目级固定工具链。 |
| Node/npm | Node 26.13.0 / npm 11.2.0 | 新 TS 工具链尚未安装。 |
| 桌面依赖 | 当前 Electron 44.5.1、React 19.3.0、Vite 8.3.2 | TS 迁移与最终包回归。 |
| FFmpeg | 已安装，当前为共享库构建 | 发布时带齐动态库；不能只复制一个 exe。 |
| 权重 | 本地已有 ASR 0.6B、1.7B 与 ForcedAligner 0.6B | 文件完整性、Candle 结构/精度兼容。 |
| 官方 Python 基线 | `.venv-asr` 未安装 `qwen-asr` | 在独立测试环境接入匹配版本；不改现有 GLM/TTS 环境。 |

旧版 `npm test`：28/28 通过（普通本机环境）。首次在沙箱运行时 26/28：一项被 junction 权限拒绝，另一项因沙箱临时路径大小写差异失败；未修改代码或断言，在普通本机环境重跑两项均通过。

加入准备工具后的 `npm test`：39/39 通过、0 跳过，其中 11 项为样本准备测试。新增脚本与测试的 Node 语法检查通过；两个官方 WAV 的离线哈希、格式、帧数和时长校验通过，共 2307028 字节。已确认音频缓存被 Git 忽略。完整旧包的 106 个文件集合、大小及哈希复核一致；应用源码和原打包脚本相对基线未改动。

本轮不安装模型依赖、不下载权重、不升级工具链、不启动 GPU 推理、不构建新的软件包。Rust CPU/CUDA、官方 Python 对照、真实视频转写、精确字幕与内容总结均尚未测试。

下一轮从 P1 开始：先编译最小 Rust CLI，先中文 4.2 秒样本，再英文和 CPU/CUDA 对照；达到门槛后才扩展长视频、界面迁移与发布包。任何推理/长编译前先说明时间、GPU、磁盘影响。
