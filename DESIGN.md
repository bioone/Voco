---
name: qwenASR 语音工作台
description: 本地桌面语音合成、转写与声音库的界面设计系统
colors:
  ink: "#24332d"
  muted: "#566950"
  supporting-ink: "#52654c"
  accent: "#267259"
  accent-hover: "#1d5b46"
  background: "#f5f7f4"
  sidebar: "#eaf0e7"
  sage: "#edf3ec"
  line: "#e1e7df"
  panel: "#fff"
  panel-tinted: "#fbfdf9"
  field-border: "#d7e1d5"
  field-ink: "#293b2e"
  focus-soft: "#cbe1ce"
  selected: "#edf5eb"
  selected-border: "#8eb798"
  completed-background: "#e6f2e5"
  completed-ink: "#2d6b40"
  error-background: "#fff4ed"
  error-ink: "#9a4e2c"
  recording: "#b95444"
typography:
  headline:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 650
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.75
  editor:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.95
  label:
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 500
  path:
    fontFamily: '"Cascadia Code", Consolas, monospace'
    fontSize: "11px"
rounded:
  panel: "12px"
  button: "7px"
  field: "6px"
  navigation: "8px"
  status: "5px"
spacing:
  small: "8px"
  compact: "12px"
  field-gap: "16px"
  panel-compact: "20px"
  panel: "24px"
  desktop-gutter: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    rounded: "{rounded.button}"
    padding: "11px 16px"
    height: "39px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "#3e5945"
    rounded: "{rounded.button}"
    padding: "11px 16px"
    height: "39px"
  field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.field-ink}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  navigation-active:
    backgroundColor: "{colors.panel}"
    textColor: "#235e45"
    rounded: "{rounded.navigation}"
    padding: "13px 14px"
  status-completed:
    backgroundColor: "{colors.completed-background}"
    textColor: "{colors.completed-ink}"
    rounded: "{rounded.status}"
    padding: "4px 7px"
---

# Design System: qwenASR 语音工作台

## Overview

**Creative North Star: "日光下的本地语音工作室"**

这是 Windows 桌面上的连续工作界面：侧栏提供稳定的任务入口，白色编辑区容纳文本与音色描述，浅绿色结果区承接进度、试听和导出。绿色集中在可执行动作、选中状态和就绪反馈，让长时间编辑时的视觉层级保持清楚。

界面沿用系统字体、原生文本框、选择器和音频控件。工作状态通过文字、图标和控件状态共同表达；声音的表达来自真实试听与完整提示词。该名称描述从实际代码提取的视觉方向，属于推定的实现决定，不代表用户确认的视觉形式或品牌主张。

**Key Characteristics:**

- 浅鼠尾草色导航、白色编辑面板、深绿色主要操作。
- 固定任务入口与就近结果反馈，适合反复编辑、试听和重试。
- 原生输入与音频控件，中文标签和具体动作名称。
- 圆角与细边框区分容器，留白服务于文本与任务状态。

## Colors

配色以带少量绿色的浅中性色为底，使用一种主要动作色和独立的错误、录音状态色。前置 token 是数值依据，来源为 `src/renderer/styles.css`。

### Primary

- **深绿动作色**：`accent` 用于生成、转写、导出、复用描述和键盘焦点；`accent-hover` 为可用主按钮的悬停状态。
- **浅鼠尾草选中色**：`selected` 与 `selected-border` 用于音色预设的选中反馈。较浅的 `sage` 用于计数等辅助区域。

### Neutral

- **墨绿正文**：`ink` 是主要文字，`muted` 用于页面介绍与一般说明，`supporting-ink` 用于占位提示、次级说明、声音描述和音频元信息，`field-ink` 用于表单内容。次级文字在最终审查后加深，以保持浅色背景上的可读性。
- **日光底色**：`background` 承托整个工作区，`sidebar` 区分导航，`panel` 承托编辑内容，`panel-tinted` 承托任务结果。
- **细边界**：`line` 分隔面板和内部段落，`field-border` 标示可编辑控件边界，`focus-soft` 是输入焦点的柔和外圈。

成功标记使用 `completed-background` 与 `completed-ink`；错误详情使用 `error-background` 与 `error-ink`；录音按钮与录音指示点使用 `recording`。所有状态同时显示可读文字，颜色不能成为唯一信息。

## Typography

全局字体采用 Windows 系统无衬线栈；中文回退为微软雅黑。路径输入使用本机等宽栈。没有外部字体依赖。

- **Headline**：页面任务标题，字重与紧凑字距使入口清楚；随窄窗尺寸逐级缩小。
- **Title**：面板标题与章节标题，保持小而明确的层级。
- **Body**：页面介绍、按钮和一般表单内容；长说明采用更宽松行高。
- **Editor**：主文稿编辑区比元信息更大，保留足够的中文行距。
- **Label**：字段名与状态辅助信息；路径、采样率、时长和计时器保持可扫描。

数字型音频元信息、时长与录音计时使用等宽数字。完整文本和提示词允许换行，文件名在列表中截断，在详情中可阅读。

## Layout

桌面壳层采用侧栏加主工作区。默认侧栏宽度为 (216px)，顶部栏高度为 (72px)，主区最大宽度为 (1700px)。主编辑区和结果区并排，默认结果栏宽度为 (304px)、间距为 (22px)。声音库和任务记录使用同样的列表加详情关系。

面板标题与主要内容围绕 (20px–24px) 内边距组织，表单列使用 (16px) 间距。编辑动作放在编辑面板底部；结果的取消、试听、复制和导出放在对应任务附近。

- 在宽度至少 (1450px) 时，结果栏增至 (345px)，主区采用更大的侧边留白。
- 在宽度不超过 (1120px) 时，侧栏收至 (184px)，结果栏收至 (270px)，面板间距收至 (16px)。
- 在宽度不超过 (920px) 时，侧栏为 (165px)，编辑与结果、列表与详情均纵向排列。
- 在宽度不超过 (620px) 时，侧栏成为顶部横向任务导航，表单改为单列，控件与留白随窄窗缩小。
- 桌面宽度至少 (921px) 时，编辑区和音色区采用压缩高度，以便常见窗口中可见提交动作。
- 在宽度至少 (1250px) 时，音色描述在左，名称与复用选择器在右；此规则位于样式表末尾，覆盖更早的编辑区高度规则。

这些断点描述当前浏览器布局能力。Electron 默认窗口为 (1440px × 960px)，最小窗口为 (1050px × 720px)，以主进程配置为准；更窄布局主要服务于浏览器预览和后续窗口策略调整。

## Elevation & Depth

面板通过背景色、细边框和分隔线建立层次，常态下不使用面板阴影。阴影只出现在侧栏当前页和临时通知，避免大面积抬高每个编辑区。

- **当前导航**：`0 2px 6px #536a4910`，强化白色当前页在浅绿色侧栏中的位置。
- **临时通知**：`0 8px 25px #4c69471c`，将固定底部反馈与页面内容分开。

## Shapes

主要面板使用柔和的大圆角，按钮与输入使用较小圆角；导航项与状态标记保留各自尺度。准确半径见前置 token。主文稿编辑区嵌在面板内，边框与圆角置零，让文本本身占据视觉主位。

图标只用于任务识别、操作识别与状态说明。圆形空结果图标、声音图标块与上传区图标属于辅助提示，不承担不可见的操作。

## Components

### Buttons

主按钮表达提交、导出和复用等明确动作；次按钮用于文件选择、取消、检测和查看文件。主按钮悬停加深，次按钮悬停进入浅绿色背景。禁用按钮降低透明度并显示不可用光标。小按钮用于顶部检测和紧凑结果操作。文字按钮用于示例、日志展开、复制和打开文件位置。

键盘可见焦点使用动作色 (2px) 外描边与 (3px) 偏移。按钮的背景、边框和文字颜色以 (150ms) 过渡；减少动态效果偏好关闭过渡与动画。

### Cards / Containers

编辑、结果、声音库、历史记录与设置共享面板边界和圆角。面板内部用标题行、编辑区、说明区和操作区建立层级。列表保持平面行结构，选中行使用浅绿色底色。

### Inputs / Fields

输入框、选择器和提示词文本框保留浏览器原生交互。表单焦点提高边界对比并增加柔和焦点圈。主文稿区的焦点通过极浅底色变化表达；其标签为屏幕阅读器保留。必填文稿与提示词为空时，生成动作禁用。

### Navigation

导航按语音合成、语音转文字、声音库、任务记录排列，环境设置位于侧栏底部。当前页以白色背景、绿色文字和图标字重变化显示，主要导航附带 `aria-current`。窄窗布局仍保留文字标签。

### Filters and Status

声音分类与任务类型过滤使用短文字按钮，选中项增加浅绿色背景和字重。任务状态区分等待、执行、完成、失败、取消和中断；执行中的旋转图标与消息相邻。错误正文可以换行，不截断可操作的故障说明。

### Prompt Reuse

声音库先展示真实记录的名称、分类、语言和时长。选择声音后，详情区提供原生试听、完整音色描述和示例文本；“用这个描述合成”将完整提示词和语言带回合成编辑区。编辑区也提供原生声音库选择器。提示词可继续编辑，界面说明再次生成的音色可能存在差异。

## Do's and Don'ts

### Do:

- **Do** 保持编辑面板、任务反馈和主要操作之间的明确对应关系。
- **Do** 显示声音库原始完整提示词，让用户试听后有依据地复用。
- **Do** 使用原生文本、选择、进度和音频控件，保留键盘与辅助技术语义。
- **Do** 让任务状态、错误原因与取消结果具有可读文字。
- **Do** 按已实现的断点和圆角尺度扩展界面，更新样式时同步更新设计文档。

### Don't:

- **Don't** 把音色描述复用表述为保证相同音色的声音克隆。
- **Don't** 用装饰性波形、隐喻按钮或图标替代必要的文字操作与真实试听。
- **Don't** 仅凭颜色表示任务成功、失败或录音状态。
- **Don't** 为普通面板添加悬浮阴影、外部字体或无功能的动画。
- **Don't** 在本次语音工作台范围内加入 PDF 或 OCR 页面。

### Voice sample audition

An inline sample section reuses existing colors, hairlines, native audio controls and the text-button style. It shows the indexed voice name, language and sample text after a voice selection. Selection triggers playback, repeating selection or the replay action starts from the beginning, and changing selection or leaving the surface stops the previous sample. Initial launch and task-result players remain manual. The section spans the preparation panel grid and uses normal vertical scrolling in compact windows.

