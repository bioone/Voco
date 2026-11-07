# Voco

Voco 的新主线采用 Rust + Candle、Electron 和 TypeScript，目标是直接加载本地权重的音视频转写软件。**当前处于方案与测试素材准备阶段，Rust 推理和新版桌面软件尚未实现。**

- [`main` 总计划](docs/voco-architecture.md)：模块职责、接口、当前范围、候选扩展、实施阶段与验收。
- [推理与测试细则](docs/rust-electron-ts-plan.md)：CPU/CUDA、官方样本、质量门槛及已完成的准备验证。
- `legacy/electron-python`：保留原工作台源码；旧软件包仍在 `release/win-unpacked/`。

视频下载、文案处理、摘要等是后续候选，当前只设计接入边界。远程仓库为 [bioone/Voco](https://github.com/bioone/Voco)。

以下说明适用于当前保留的 Electron + React + Python 工作台代码，支持语音合成、音频转文字和声音库，使用项目已有模型与 Python 环境；不代表 Rust 新版已经具备这些能力。

## 启动

需要 Node.js 22.12+。本机已安装前端依赖，直接在项目目录运行：

```powershell
npm start
```

也可以双击 `scripts/launch.cmd`。`npm start` 会先构建 React 页面，再打开 Electron 窗口。开发时使用 `npm run dev`；仅在浏览器检查页面时使用 `npm run preview`，浏览器预览不能推理或读取本地声音库。

在其他已配置模型的机器上首次运行：

```powershell
npm ci
npm start
```

这些 npm 命令安装桌面界面依赖与 Electron 运行时，不安装 Python 模型依赖或下载模型权重。Electron 安装需要网络。Windows unpacked 目录可以通过下方命令生成，双击其中的 EXE 即可启动。


## Windows unpacked 直接运行

当前电脑可以运行 `release/win-unpacked/qwenASR.exe`，无需通过终端、Node.js 或 npm 启动。必须保留整个 `win-unpacked` 文件夹，EXE 旁边的 DLL、locales 与 resources 都是运行所需文件。

重新打包：

```powershell
npm run package:win
```

该命令构建 React 页面并复制本项目已安装的完整 Electron 运行时，不额外联网下载运行时，不打入模型权重、用户音频或大型 Python 环境。使用 Electron 官方支持的 [预构建运行时分发方式](https://www.electronjs.org/docs/latest/tutorial/application-distribution)。已有 `win-unpacked` 目录会保留，新构建会写入带时间后缀的目录。

应用和 Python 后端源码打包在 `resources/app`、`resources/python`。默认通过 `resources/runtime-location.json` 的 `projectRoot: "../../.."` 查找当前项目中的模型、`.venv-tts`、`.venv-asr`、声音库和输出目录；路径相对于 `resources` 解析，与双击时的工作目录无关。

**本次生成的是当前电脑使用的 unpacked 软件。请保持它位于本项目的 release 目录。** 若移动整个软件目录，需要修改 `resources/runtime-location.json` 指向原项目目录；只复制 EXE 或整个 unpacked 到另一台尚未配置 Python/CUDA/模型的电脑，并不能直接推理。大型环境不随本次软件重复复制。

打包验证不执行模型推理：

```powershell
node scripts/check-unpacked.cjs
```

验证会从其他工作目录启动真实打包 EXE，检查内置 React 页面、预加载接口、现有声音库、独立 Python 环境与 CUDA。报告保存在 `outputs/packaged-check/report.json`。
## 语音功能

- **语音合成**：输入文本，选择语言，用完整音色描述控制声音。支持中文、英文、日文、韩文等模型语言；请使文本与语言一致。预设描述可以编辑。点击快捷声音或声音库下拉选项，会直接播放已有例音，并展示例音名称、原文和播放器；可以暂停或重新试听。快捷声音采用所播放例音的完整音色提示词，不会改动已写好的合成文本或所选语言。
- **语音转文字**：选择 WAV、FLAC、OGG，或使用麦克风录制最多 5 分钟的声音。GLM-ASR 自动识别语言，长音频按 30 秒片段处理，保存完整文本和片段时间。单次文件最多 2 小时且解码大小不超过 512 MB。分段边界、噪声、方言与多人重叠讲话仍需校对。
- **声音库**：读取原有 `voice_design/voice_library.csv` 和新生成声音，按分类筛选、搜索、试听、查看示例文本与完整提示词。点击一条声音会立即试听，重复点击从头播放；切换声音或离开页面会停止旧例音。复用的是音色描述，声音设计每次推理可能有差异。
- **任务记录**：合成与识别共享串行队列，显示进度、错误和日志，支持取消、重新执行、复制与导出。
- **环境设置**：分别配置 Python、模型目录及 GPU 编号。检测只检查依赖、模型配置和 CUDA，不加载权重；检测通过不保证任意长度任务都有足够显存。

推理会使用 GPU，首次加载可能耗时数分钟。每个任务单独启动 Python 进程，完成或取消后释放进程。应用不会自动安装大型依赖，也不会自动退回 CPU 或云端服务。真正的麦克风使用仍取决于 Windows 麦克风权限和设备；没有麦克风时可导入文件。

## 默认运行环境

| 功能 | Python | 本地模型 |
| --- | --- | --- |
| 合成 | `.venv-tts/Scripts/python.exe` | `model/Qwen3-TTS-12Hz-1.7B-VoiceDesign` |
| 识别 | `.venv-asr/Scripts/python.exe` | `model/GLM-ASR-Nano-2512` |

路径均相对于项目目录解析，也支持在设置中选择绝对路径。原脚本使用的其他虚拟环境不受修改。GPU 编号使用当前 CUDA 可见设备的索引。

## 文件保存

```text
outputs/
  tts/<任务 UUID>/audio.wav, text.txt, prompt.txt, metadata.json
  tts/voice_library.csv
  asr/<任务 UUID>/audio.wav, transcript.txt, metadata.json
  recordings/<唯一文件名>.wav
```

原始输入与原声音库只读。新任务使用独立目录，不覆盖已有结果。ASR 的 `audio.wav` 是归一化后的 16 kHz 单声道副本。元数据记录源文件、采样率、时长、模型、耗时和片段信息。任务历史及设置位于 Electron 用户数据目录中的 `studio-state.json`；历史最多保留 200 条左右，产物文件独立保留。关闭应用会终止当前推理，未完成任务下次启动显示为中断，可手动重试。

导出使用原生保存对话框，可选择位置；覆盖时由对话框确认，禁止写入模型目录。播放只允许声音库、应用输出和本次原生文件对话框明确选择的音频。

## 验证

```powershell
npm run verify
```

执行 Electron 语法检查、Node 最小功能测试、两套环境的 Python 语法与功能测试，以及 React 生产构建，不运行真实模型。桌面检查命令：

```powershell
node_modules/.bin/electron.cmd scripts/smoke-electron.cjs
```

桌面检查使用独立测试历史、模拟麦克风和项目内测试导出，验证 IPC、文件限制、音频时长与播放、录音保存、声音描述复用、文稿保留和布局。结果在 `outputs/desktop-check/report.json`，截图在 `.impeccable/review/`。模型往返小样本已另行验证：`你好，欢迎来到语音工作台。` 合成为 3.44 秒、24 kHz WAV，GLM-ASR 完整识别回同一句；主观音色尚需试听。

如果提示 CUDA 不可用，检查设置中的解释器是否指向对应 CUDA 环境。如果显存不足，关闭其他 GPU 程序，合成时缩短文本后重试。若声音库索引提示锁未释放，先确认没有正在写入的任务，再检查 `outputs/tts/.voice_library.lock`；应用不会擅自清理已有产物。

## 代码结构

- `src/renderer/`：React 界面、表单与 PCM WAV 录音。
- `src/electron/`：桌面窗口、受限预加载接口、单任务队列、文件与流式播放。
- `src/tts/`、`src/asr/`：本地模型推理及输出写入。
- `src/backend/`：通用校验、元数据、声音库与 JSON 行协议入口。
- `tests/`、`scripts/`：最小验证和启动工具。

Electron 启用 `contextIsolation`、渲染进程沙箱和内容安全策略；页面通过固定预加载接口与主进程交互，模型在独立 Python 进程中运行。实现遵循 [Electron 安全指导](https://www.electronjs.org/docs/latest/tutorial/security) 与 [上下文隔离说明](https://www.electronjs.org/docs/latest/tutorial/context-isolation)。

模型、用户音频、生成物、OCR 产物与 PDF 已列入 `.gitignore`；现有批量脚本和模型权重未修改。


