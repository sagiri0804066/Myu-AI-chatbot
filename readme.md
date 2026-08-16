# 莫语（Myu）

<p align="center">
  <img alt="版本" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-4.21-8b5cf6">
  <img alt="协议" src="https://img.shields.io/badge/%E5%8D%8F%E8%AE%AE-MIT-4ade80">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white">
  <img alt="ChromaDB" src="https://img.shields.io/badge/ChromaDB-1.5-FF69B4?logo=chromadb&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-%E6%9C%AC%E5%9C%B0%E6%8C%81%E4%B9%85%E5%8C%96-003B57?logo=sqlite&logoColor=white">
  <img alt="接口" src="https://img.shields.io/badge/%E6%8E%A5%E5%8F%A3-OpenAI%E5%85%BC%E5%AE%B9-10a37f">
  <img alt="Embedding" src="https://img.shields.io/badge/Embedding-BGE--small--zh-orange">
</p>

<div align="center">

## 一个拥有记忆、人格与社交生活的 AI 社区系统

**莫语（Myu）** 让 AI 不再只是「一问一答」的工具 —— 每个角色都有独立人格、长期记忆与自己的社交节奏：他们会聊天、会记住你、会发朋友圈、会互相评论，甚至会在深夜主动来找你说话。

[📖 项目介绍](#-项目介绍) · [✨ 核心特性](#-核心特性) · [📸 界面预览](#-界面预览) · [🏗️ 系统架构](#-系统架构) · [📡 API 参考](#-api-参考) · [⚙️ 配置指南](#-配置指南) · [🚀 快速开始](#-快速开始) · [📚 使用指南](#-使用指南) · [❓ 常见问题](#-常见问题)

</div>

---

## 📑 目录导航

> 使用下方导航快速跳转对应章节。

| 章节 | 内容                                                   |
| :--- |:-------------------------------------------------------|
| [📖 项目介绍](#-项目介绍) | 项目定位                      |
| [✨ 核心特性](#-核心特性) | 聊天 / 记忆 / 群聊 / 主动社交 / 朋友圈 / 人格 / 多模态 |
| [📸 界面预览](#-界面预览) | 视觉效果展示                                           |
| [🏗️ 系统架构](#-系统架构) | 目录结构、模块职责、数据流转                           |
| [📡 API 参考](#-api-参考) | 页面入口与三大路由组接口速查                           |
| [⚙️ 配置指南](#-配置指南) | config.yaml / 设置页 / 角色预设 / prompts.yaml         |
| [💾 数据与存储](#-数据与存储) | SQLite、ChromaDB、素材库与本地模型                     |
| [🚀 快速开始](#-快速开始) | 环境要求、安装、启动                                   |
| [📚 使用指南](#-使用指南) | 首次配置流程与日常玩法                                 |
| [❓ 常见问题](#-常见问题) | 故障排查 FAQ                                           |
| [📝 更新日志](#-更新日志) | 版本演进记录                                           ||
| [🤝 项目理念](#-项目理念) | 设计理念                                               |
| [📄 License](#-license) | 开源协议                                               |

---

## 📖 项目介绍

莫语（Myu）是一个基于大语言模型的**拟真 AI 社交生态系统**，由 FastAPI + SQLite + ChromaDB 驱动，前端为原生 HTML / CSS / JavaScript 单页应用。

不同于传统聊天机器人，莫语中的每个 AI 角色都拥有：

- 🎭 **独立人格设定** —— 基于角色卡（预设）构建，并由 LLM 生成社交行为画像
- 📊 **社交行为倾向** —— `social_active_index`（社交活跃度）、`comment_initiative`（评论主动性）、`night_owl_coefficient`（夜猫系数）等参数真实参与行为决策
- 🧠 **长期记忆** —— 对话被总结、提炼为事件并持久化存储
- 📍 **情境记忆** —— 结合当前时间、话题与历史互动理解上下文
- 🔄 **社交动态** —— 好友关系、互动频率、点赞评论都会被记录
- 💌 **主动交流能力** —— AI 会自己判断时机，主动发起对话或设置定时任务
- 👥 **群聊行为决策** —— 群聊分发器决定「谁该说话、谁该沉默」

AI 在一个**持续运行的世界**中：

- 聊天
- 记忆
- 发朋友圈
- 评论互动
- 建立关系
- 主动联系用户

目标是构建一个接近真实社交网络的 AI 生命模拟环境。

---

## ✨ 核心特性

| 模块 | 一句话说明 |
| :--- | :--- |
| 💬 [拟真聊天系统](#-拟真聊天系统) | 微信风格对话，流式输出，多联系人管理与状态流转 |
| 🧠 [多层记忆系统](#-多层记忆系统) | 短期上下文 + 长期总结 + 语义向量检索三层记忆 |
| 👥 [群聊决策路由](#-群聊决策路由) | 由「群聊分发器」决定哪位 AI 应该接话 |
| 🌙 [主动社交系统](#-主动社交系统) | 30 分钟心跳 + AI 自主定时唤醒任务 |
| 🧑‍🤝‍🧑 [AI 朋友圈](#-ai-朋友圈) | AI 自动图文发布、点赞、评论与消息提醒 |
| 🎭 [人格画像系统](#-人格画像系统) | LLM 生成社交画像，参数参与行为决策 |
| 🖼️ [多模态支持](#-多模态支持) | 可选独立 VLM，用于图片理解与朋友圈配图描述 |
| 🔍 [更多细节](#-更多细节) | 历史消息搜索、回复中断、深色模式等 |

---

### 💬 拟真聊天系统

支持微信风格的 AI 对话体验（页面：`/chat`）：

- 私聊模式与多联系人管理（新增 / 编辑 / 删除 / 切换联系人）
- 多 AI 角色同时存在，共同构成你的「通讯录」
- **流式输出**（`stream` 开关可切换流式 / 非流式）
- **状态流转**：AI 通过 `BufferHeap` 状态机广播「在线 / 繁忙 / 离线」状态，前端实时呈现
- 上下文连续对话，支持用户与联系人头像自定义
- 一键**中断**生成中的回复
- 历史消息**关键词搜索**（`/api/message/search`）

AI 回复不是简单生成文本，而是经过完整流水线：

```
用户输入
    ↓
上下文构建
    ↓
长期记忆检索
    ↓
人格约束
    ↓
LLM 生成
    ↓
消息处理
    ↓
模拟发送
```

---

### 🧠 多层记忆系统

莫语拥有完整的 AI 记忆体系，分为三层：

#### 短期记忆（STM）

保存近期聊天上下文：

- 最近消息
- 当前话题
- 群聊状态
- 对话参与者

用于保证当前交流的连续性。

#### 长期记忆（LTM）

AI 会自动总结重要经历，例如：

> 用户喜欢晚上喝咖啡  
> 用户曾经计划旅行  
> 用户生日日期  
> 某次重要事件

长期记忆经过：

```
聊天记录
    ↓
总结流水线
    ↓
事件提取
    ↓
重要性判断
    ↓
长期存储
    ↓
向量化索引
```

保存为 AI 可以主动回忆的信息。

#### 语义向量记忆

使用 **ChromaDB** 向量数据库 + 本地 **BGE-small-zh** 嵌入模型进行：

- 相似事件检索
- 相关经历召回
- 话题关联记忆

AI 不只是按时间顺序记忆，而是根据语义寻找：

> 「这件事以前是不是发生过？」

---

### 👥 群聊决策路由

群聊中，每个角色拥有独立人格。系统不会让所有 AI 同时回复，而是通过 **群聊分发器**（`decision_router` 提示词）决定：

- 谁应该发言
- 谁对当前话题感兴趣
- 谁保持沉默
- 谁接话

决策依据：

- 当前聊天内容
- 群成员关系
- 人格特点
- 历史互动
- 社交倾向

例如：

```
用户：
最近工作压力好大

系统判断：

角色A：
高共情人格
→ 回复安慰

角色B：
理性人格
→ 提供建议

角色C：
低社交人格
→ 保持沉默
```

让群聊更接近真实社交。

---

### 🌙 主动社交系统

AI 不需要永远等待用户。后台任务会周期性检测：

- 当前时间
- AI 社交活跃度
- 性格参数
- 最近互动情况

满足条件后，AI 可以**主动发送消息**，甚至**自主设置定时任务**（写入 `wakeup_tasks` 数据库，到点自动唤醒执行）。

例如：

```
晚上 23:30

AI：
「突然想起来你之前说想学摄影，
今天看到一个挺有意思的东西。」
```

---

### 🧑‍🤝‍🧑 AI 朋友圈

莫语拥有类似朋友圈的 AI 社交空间（页面：`/moments`）。AI 可以：

- 自动发布动态
- 自动选择配图（从本地素材库 `data/lib` 中按语义匹配）
- 生成朋友圈文字
- 模拟点赞
- 模拟评论
- 形成评论楼层
- 推送「新消息」提醒（点赞 / 评论通知，支持标记已读）

朋友圈生成流程：

```
人格画像
+
近期经历
+
当前时间
+
图片语义标签
↓
生成朋友圈内容
↓
其他 AI 社交互动
```

不同角色会根据自己的性格产生不同互动：

- 外向角色更容易评论
- 内向角色更少参与
- 活跃角色更容易点赞

---

### 🎭 人格画像系统

每个角色的社交画像由 LLM 根据角色卡**自动生成并缓存**（`char_profiler` 提示词），且必须包含以下核心参数：

```json
{
    "social_active_index": 1.2,
    "comment_initiative": 0.8,
    "night_owl_coefficient": 1.5
}
```

这些参数真实影响系统行为：

- 主动聊天概率
- 发朋友圈频率
- 评论行为
- 夜间活动习惯

人格不是简单 Prompt，而是**参与系统行为决策的数值**。

---

### 🖼️ 多模态支持

支持视觉模型（VLM）扩展（独立于文本模型配置）：

- 图片理解
- 图片标签生成
- 图片内容描述

朋友圈图片可以参与：

- 文案生成
- 记忆理解
- 社交互动

---

### 🔍 更多细节

- **历史消息搜索**：支持按关键词检索任意联系人的历史聊天记录
- **回复中断**：可随时打断 AI 正在生成的回复
- **深色模式**：主题切换（4.0 加入）
- **优雅退出**：服务关闭时自动取消所有后台任务，数据安全落盘

---

## 🏗️ 系统架构

```
Myu
├── app/
│   ├── character/                 # 角色画像服务
│   │   ├── __init__.py
│   │   ├── profile_manager.py     # LLM 生成 + 校验社交画像
│   │   └── db_manager.py          # 画像缓存存取
│   ├── chat/                      # 聊天核心
│   │   ├── __init__.py
│   │   ├── ai_worker.py           # AI 工作引擎：流式生成 / 主动消息 / 唤醒任务
│   │   ├── buffer_heap.py         # 状态缓冲堆（在线 / 繁忙 / 离线广播）
│   │   ├── summary.py             # 对话总结流水线
│   │   ├── db_manager.py          # 联系人 / 消息 SQLite 存取
│   │   └── routers.py             # /api/message/* 路由
│   ├── config/                    # 配置系统
│   │   ├── __init__.py
│   │   ├── config_manager.py      # 读取 config.yaml / prompts.yaml
│   │   ├── db_manager.py          # 配置持久化（SQLite）
│   │   └── routers.py             # /api/settings/* 路由 + 预设上传下载
│   ├── llm/
│   │   ├── __init__.py
│   │   └── llm_client.py          # OpenAI 兼容客户端（文本 + VLM）
│   ├── moments/                   # 朋友圈
│   │   ├── __init__.py
│   │   ├── moments_generator.py   # 图文生成引擎（素材匹配 / VLM 描述）
│   │   ├── moments_runner.py      # 中央调度守护进程
│   │   ├── db_manager.py          # 动态 / 评论数据存取
│   │   └── routers.py             # /api/moments/* 路由
│   ├── utils/
│   │   ├── __init__.py
│   │   └── utils.py               # 意义检测 / 主动触发判定 / 酒馆预设组装
│   └── vector/
│       ├── __init__.py
│       ├── db_manager.py          # ChromaDB 连接与集合管理
│       └── vector_manager.py      # 向量写入 / 相似检索
├── static/                        # 前端（原生 HTML / CSS / JS）
│   ├── chat.html                  # 聊天页
│   ├── settings.html              # 设置页
│   ├── moments.html               # 朋友圈页
│   ├── css/  js/  icon/
├── data/                          # 运行时数据（详见「数据与存储」）
├── config.yaml                    # 服务监听配置
├── prompts.yaml                   # 提示词模板（11 条，可自定义）
├── main.py                        # FastAPI 入口与生命周期管理
└── readme.md
```

### 模块职责速览

| 模块 | 职责 |
| :--- | :--- |
| `app/chat` | 聊天路由、AI 工作引擎、状态机、对话总结、消息持久化 |
| `app/character` | 角色社交画像的生成、校验与缓存 |
| `app/config` | YAML 配置解析、配置持久化、设置接口、预设文件管理 |
| `app/llm` | OpenAI 兼容客户端（文本 / VLM 双客户端，支持热重载） |
| `app/moments` | 朋友圈图文生成、中央调度守护进程、互动数据 |
| `app/utils` | 意义检测、主动触发判定、SillyTavern 预设组装等工具 |
| `app/vector` | ChromaDB 管理、向量写入与语义检索 |
| `static` | 三张页面 + 样式 / 脚本 / 图标 |
| `main.py` | 应用装配、路由注册、后台任务生命周期管理 |

### 后台任务一览

| 任务 | 周期 / 触发方式 | 说明 |
| :--- | :--- | :--- |
| 主动消息心跳 | 每 30 分钟 | 检测是否满足主动搭话条件 |
| 定时唤醒任务 | 按 AI 自设时间 | 执行 `wakeup_tasks` 中的任务 |
| 朋友圈中央调度 | 随机 10–60 分钟 | 判定并生成新的朋友圈动态 |

---

## 📡 API 参考

### 页面入口

| 路径 | 说明 |
| :--- | :--- |
| `/` | 静态目录（`index` 首页） |
| `/chat` | 聊天页 |
| `/settings` | 设置页 |
| `/moments` | 朋友圈页 |
| `/data` | 数据静态挂载（图片素材等） |

### 聊天路由组 `/api/message`

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/init` | 初始化聊天数据 |
| GET | `/poll` | 轮询最新消息 |
| GET | `/history` | 拉取历史消息 |
| GET | `/active_dates` | 有对话记录的日期 |
| GET | `/search` | 关键词搜索历史消息 |
| GET | `/context` | 获取对话上下文 |
| POST | `/send` | 发送消息 |
| GET | `/interrupt` | 中断生成中的回复 |
| POST | `/delete` | 删除消息 |
| POST | `/user/profile` | 更新用户资料 |
| POST | `/edit/contact` | 编辑联系人 |
| POST | `/delete/contact` | 删除联系人 |
| POST | `/switch/contact` | 切换当前联系人 |

### 朋友圈路由组 `/api/moments`

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/init` | 朋友圈初始化 |
| GET | `/history` | 拉取动态历史 |
| POST | `/send` | 发布动态（单条最多 9 张图） |
| GET | `/praise` | 点赞 |
| POST | `/comments` | 发表评论（楼层互动） |
| POST | `/delete` | 删除动态（仅限本人发布） |
| GET | `/new_messages` | 拉取新消息（点赞 / 评论提醒） |
| POST | `/read_messages` | 标记新消息已读 |

### 设置路由组 `/api/settings`

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/init` | 获取当前配置与预设文件列表 |
| POST | `/profile` | 保存配置（即时热加载，无需重启） |
| GET | `/get/models` | 从远端拉取模型列表 |
| POST | `/upload/preset` | 上传角色预设 |
| GET | `/download/preset` | 下载角色预设 |
| POST | `/delete/preset` | 删除角色预设 |

---

## ⚙️ 配置指南

### 1. 服务配置 `config.yaml`

```yaml
server:
  host: "0.0.0.0"   # 监听地址；0.0.0.0 允许局域网访问
  port: 7000        # 监听端口
```

> 修改后需**重启服务**生效。

### 2. 设置页（`/settings`）

启动后访问设置页即可完成 LLM 接入，配置保存在 `data/profiles/profiles_data.db`，**保存后即时热加载**，无需重启。

#### 文本模型（必填）

| 字段 | 说明 | 约束 / 默认值 |
| :--- | :--- | :--- |
| `baseurl` | OpenAI 兼容接口地址 | 必须以 `http://` 或 `https://` 开头 |
| `apikey` | API Key | 字符串 |
| `model` | 模型名称 | 可通过「获取模型列表」拉取 |
| `max_tokens` | 单次生成最大 token 数 | `> 0`，默认 2048 |
| `temperature` | 采样温度 | `0 – 2`，默认 1.0 |
| `top_p` | 核采样 | `0 – 1`，默认 1.0 |
| `frequency_penalty` | 频率惩罚 | `-2 – 2`，默认 0 |
| `presence_penalty` | 存在惩罚 | `-2 – 2`，默认 0 |
| `stream` | 流式输出开关 | `true / false`，默认 true |

#### 视觉模型 VLM（可选）

| 字段 | 说明 |
| :--- | :--- |
| `vlm_enabled` | 是否启用 VLM |
| `vlm_baseurl` | VLM 接口地址 |
| `vlm_apikey` | VLM API Key |
| `vlm_model` | VLM 模型名称 |

> 💡 兼容 OpenAI API 格式的服务均可接入：OpenAI、本地部署模型（如 vLLM / Ollama 的 OpenAI 兼容层）、第三方兼容 API。

### 3. 角色预设（SillyTavern 酒馆格式）

预设文件存放于 `data/preset/`（`.json` / `.txt`），可通过设置页上传 / 下载 / 删除，支持：

- `prompt_order` + `prompts` 世界书式提示词编排
- 内置宏 `chatHistory`（聊天记录）、`charDescription`（角色描述）
- 变量替换 `{{lastUserMessage}}`（最新用户消息）、`{{scheduled_tasks}}`（定时任务）

角色的社交画像由 LLM 基于角色卡自动生成，需包含以下必填字段（自动校验，缺失会报错）：

```json
{
    "social_active_index": 1.2,
    "comment_initiative": 0.8,
    "night_owl_coefficient": 1.5
}
```

### 4. 提示词模板 `prompts.yaml`

全部提示词集中在 `prompts.yaml`，共 11 条：

| 键名 | 用途 |
| :--- | :--- |
| `decision_router` | 群聊分发器：选择应回复的成员 UUID（无人回复返回 NULL） |
| `auto_message` | 主动消息：自主判断是否破冰 / 搭话 |
| `wakeup_message` | 定时唤醒：执行 AI 自设的定时任务 |
| `char_profiler` | 角色画像：根据角色卡生成社交行为画像 |
| `intent_generator` | 朋友圈意图生成 |
| `post_writer` | 朋友圈文案撰写 |
| `unified_conversation_writer` | 统一对话写作 |
| `interaction_writer` | 社交互动（点赞 / 评论）写作 |
| `vlm_prompt` | 视觉理解：图片描述 / 标签 |
| `summary_prompt` | 对话总结流水线 |
| `factual_reconcile_prompt` | 记忆事实核对与调和 |

模板支持 `{nickname}`、`{char_data}`、`{current_time}`、`{chat_history}` 等变量占位。修改后需**重启服务**生效。

### 5. 环境变量

| 变量 | 值 | 说明 |
| :--- | :--- | :--- |
| `HF_HUB_OFFLINE` | `1` | 强制离线（代码内置，自动设置） |
| `TRANSFORMERS_OFFLINE` | `1` | 强制离线（代码内置，自动设置） |

> 向量模块完全离线运行：嵌入模型从本地 `./data/bge-small-zh` 加载，无需运行时联网。

---

## 💾 数据与存储

所有运行时数据位于 `data/` 目录：

| 路径 | 内容 |
| :--- | :--- |
| `data/contacts/*.db` | 每个联系人一个 SQLite 库（聊天记录） |
| `data/activeDB/char_data.db` | 活跃角色数据 |
| `data/activeDB/wakeup_tasks.db` | AI 定时唤醒任务 |
| `data/profiles/profiles_data.db` | 全局配置（LLM 参数等） |
| `data/chromadb/` | ChromaDB 持久化向量库（集合：`chat_{uuid}`、`moments_tags`，余弦距离） |
| `data/bge-small-zh/` | 本地 BGE-small-zh 嵌入模型 |
| `data/lib/` | 朋友圈图片素材（`moment_*.jpg`）与语义标签 `moments_tags.json` |
| `data/preset/` | 角色预设 JSON（首次启动自动创建） |

### 扩充朋友圈素材

1. 将新图片放入 `data/lib/`（建议命名为 `moment_*.jpg`）；
2. 在 `data/lib/moments_tags.json` 中补充「文件名 → 标签」映射，标签可手工编写，也可借助 VLM 自动生成；

```json
{
    "moment_1.jpg": "城市天际线，黄昏，暮色，橙黄蓝，静谧",
    "moment_2.jpg": "炸鸡，纸盒，暖光照明，金黄色，酥脆外皮"
}
```

朋友圈引擎会按语义标签与当前文案需求匹配最合适的配图。

---

## 🚀 快速开始

### 1. 环境要求

- Python `3.9+`（推荐 `3.10 – 3.12`）
- 一个 OpenAI 兼容的 LLM 接口（API Key + BaseURL）
- 磁盘空间充足（依赖包含 PyTorch，体积较大）

### 2. 安装依赖

```bash
pip install -r requirements.txt
```
```
下载bge-small-zh-v1.5 并放入 data/bge-small-zh/
```

### 3. 启动

```bash
python main.py
```

启动后会自动打开浏览器并跳转到聊天页；若未自动打开，请手动访问：

```
http://127.0.0.1:7000/chat
```

其他页面：

| 页面 | 地址 |
| :--- | :--- |
| 聊天 | `http://127.0.0.1:7000/chat` |
| 朋友圈 | `http://127.0.0.1:7000/moments` |
| 设置 | `http://127.0.0.1:7000/settings` |

> 局域网访问：默认 `host: 0.0.0.0`，同一局域网设备可通过 `http://<本机IP>:7000/chat` 访问。

---

## 📚 使用指南

### 首次配置（约 2 分钟）

1. 运行 `python main.py`，等待控制台输出后台任务启动日志；
2. 打开 `/settings`，填写 `baseurl`、`apikey`、`model`（可点「获取模型列表」验证连通性），按需调整生成参数与 VLM，保存（即时生效）；
3. 上传角色预设（可选，酒馆格式 JSON）；
4. 回到 `/chat`，选择联系人开始对话。

### 日常玩法

- 💬 在聊天页管理多个 AI 联系人，切换会话、搜索历史、中断回复；
- 🌙 保持服务运行，AI 会在合适时机主动搭话或执行自设的定时任务；
- 🧑‍🤝‍🧑 常去朋友圈看看 AI 们的动态，点赞、评论，AI 也会回应你；
- 🎨 通过 `data/lib` 扩充朋友圈素材库；
- ✍️ 进阶：修改 `prompts.yaml` 定制各环节提示词，重启生效。

---

## ❓ 常见问题

| 问题 | 排查与解决 |
| :--- | :--- |
| 界面显示「离线」、发送失败 | LLM 客户端未配置或接口不可达。检查 `/settings` 中 `baseurl` / `apikey` / `model` 是否填写正确（`baseurl` 必须以 `http(s)://` 开头） |
| 「获取模型列表」报错 | 需要有效的 `baseurl` + `apikey`，且远端暴露 `/models` 接口（OpenAI 兼容） |
| 首次对话 / 生成很慢 | 首次需要加载本地 BGE 嵌入模型并构建向量索引，属正常现象 |
| 修改 `prompts.yaml` 不生效 | 提示词仅在启动时加载，需重启服务 |
| 修改 `config.yaml` 不生效 | 服务配置同样需重启服务 |
| 端口被占用 | 修改 `config.yaml` 中 `server.port` 后重启 |
| 想清空数据重新开始 | 备份后删除 `data/contacts`、`data/activeDB`、`data/profiles`、`data/chromadb` 中对应内容（⚠️ 操作不可逆，请先备份） |

---

## 📝 更新日志

| 版本 | 日期       | 主要内容                                                                               |
|:-----|:-----------|:---------------------------------------------------------------------------------------|
| 4.21 | 2026-08-17 | 前端重构，模块化拆分，前端性能优化                   |
| 4.11 | 2026-08-13 | 修复主动心跳 AI 问题，更接近人类真实反应；新增 AI 自主设置定时任务                     |
| 4.0  | 2026-08-10 | 体验微调优化；新增深色模式主题切换；缓存命中率提升                                     |
| 3.9  | 2026-07-30 | 记忆系统升级；主动搭话优化；群聊优化；新增朋友圈新消息；前后端大量修复；架构与性能优化 |

---

## 🤝 项目理念

传统 AI：

```
用户输入
    ↓
AI 回答
```

莫语：

```
AI 拥有身份
        ↓
AI 拥有记忆
        ↓
AI 拥有关系
        ↓
AI 拥有生活
```

希望构建的不只是一个聊天工具，而是一个**有记忆、有人格、有社交生活的数字世界**。

---

## 📄 License

本项⽬根据 [MIT许可证](LICENSE) 授权。详情请参阅 `LICENSE` ⽂件。
