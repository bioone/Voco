# qwenASR 语音工作台

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

用户指定 Electron + React。Vite 构建页面，Electron 主进程连接独立 Python 推理进程。

## Product Purpose

把已有本地语音模型和声音库做成中文桌面工具。用户确认本版只完成语音合成、语音转文字和声音库，PDF 解析暂不加入。

## Operating Context

Windows 项目已有 .venv-tts 和 .venv-asr 独立环境。推理使用 CUDA GPU；界面与声音库试听不加载模型。

## Capabilities and Constraints

- 合成使用本地 Qwen3-TTS-12Hz-1.7B-VoiceDesign 与自然语言音色提示词。
- 转写使用已有本地 GLM-ASR-Nano-2512。
- 生成物放在 outputs 独立目录，保存文本、提示词、采样率、时长和元数据。
- 原始声音库只读，模型权重禁止修改或下载。
- GPU 任务串行执行，提供取消、失败反馈和历史记录。

## Evidence on Hand

test_voice_design.py、run_asr.py、voice_design/voice_library.csv 和两套已安装 Python 环境。

## Open Decisions

主要场景按本地音频创作和转写推定；用户未指定品牌与视觉风格。先直接实现，不设置未确认的效果图工作流默认。
