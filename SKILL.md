---
name: ai-digest
description: 生成每日 AI 早报：抓 GitHub 热门 + 搜昨日行业新闻，按用户倾向筛选并给出判断，输出到对话或推到 QQ。首次使用会先问清倾向。
---

# AI 早报

给用户生成一份当天可读的 AI 早报。默认覆盖「昨天」的行业新闻和当下 GitHub 热门 AI 项目。

这个 skill 不做「通稿」：每条新闻和项目都要带一句自己的判断，数字必须来自实际抓取。

## 第 0 步：环境自检（第一次必做）

先跑：

```bash
node scripts/preflight.mjs          # 只在对话里看
node scripts/preflight.mjs --qq     # 计划推 QQ
```

逐行看结果：`✓` 正常，`!` 是降级（比如 trending 被墙，会自动退回 API 快照），
`✗` 是阻塞。有 `✗` 就先把问题告诉用户、给出修法，不要硬跑。

自检通过后再进入下一步。

## 首次调用：先问倾向（只问一次）

配置默认写到当前目录的 `.ai-digest/config.json`（沙箱里 `~/.config` 可能不可写；
需要换位置就设 `AI_DIGEST_CONFIG` 环境变量）。

如果这个文件不存在，先问用户三个问题，然后写配置：

1. **关注倾向**：想偏哪边？例如「大模型能力与定价」「agent / skill 工程」「开源生态」「融资与监管」。可以多选。
2. **篇幅与语气**：多长（默认 1100 字）、要不要「判断」写得尖锐一点。
3. **推送方式**：只在对话里看，还是推到 QQ（需要本机有 OneBot 服务）。

写完后告诉用户「以后不再问，改配置随时说」。

再顺口提一句（可选，不要纠缠）：GitHub 数据默认免认证抓取，每小时只有 60 次；
配一个只读 token 能提到 5000 次，跑脚本 `bash scripts/set-github-token.sh` 按提示粘贴即可，
输入不回显。用户不配就跳过，不影响使用。

配置形如：

```json
{
  "focus": ["大模型能力与定价", "agent / skill 工程"],
  "length": 1100,
  "tone": "偏工程，少形容词",
  "delivery": "chat",
  "qq": { "user_id": 0, "onebot_url": "ws://127.0.0.1:3001" }
}
```

`delivery` 取 `chat`（默认）或 `qq`。选 qq 时必须填 `qq.user_id`。

## 每次运行的流程

### 1. 定日期
默认昨天。用户点名日期就用用户的。

### 2. 采集

GitHub（可选脚本）：

```bash
node scripts/collect-github.mjs --limit 5
```

输出 JSON 数组，字段 `repo / starsToday / totalStars / desc / topics`。
脚本失败或本机没有 Node，就跳过 GitHub 部分，或改用 web_fetch 抓 `https://github.com/trending` 自行解析。

新闻：用 web_search 搜 `<日期> AI news` / `<日期> 大模型` 等，至少两个角度（英文、中文各一）。

### 3. 筛选

按优先级取 4-6 条：大模型发布/能力更新 > 重要融资收购 > 有实际影响的论文 > 监管政策。
与 `focus` 相关的优先；纯营销稿、无信息量的转发不要。

拿不准的一律标「未证实」，绝不用推测补全细节。

### 4. 成稿

严格按 [references/output-format.md](references/output-format.md) 的模板。要点：

- 新闻每条两行：第一行「发生了什么 + 为什么重要（来源域名）」，第二行「判断：…」
- GitHub 每条两行：仓库名 — 解决什么问题 — 今日 +N 星（总计 M 星），第二行「点评：…」
- 结尾「对你的意义」1-2 句，要具体到某一条，不说「值得关注」
- 数字只许来自采集结果；缺失就写「未知」，不许估

### 5. 交付

- `delivery: chat` → 直接把正文作为回复发出，同时落盘到 `.ai-digest/out/<日期>.txt`（顺手建目录）。
- `delivery: qq` → 先成稿，再发：

```bash
node scripts/send-qq.mjs --user <user_id> --file <正文文件>
```

发送失败就退回对话内输出，并说明原因。

## 硬性约束

- 纯文本，不用 markdown 表格、不用 `**` 加粗（QQ 不渲染）
- 全文不超过 `length`（默认 1100 字），每条判断/点评 ≤ 40 字
- 不寒暄、不说「以下是」、不复述自己的总结
- 某部分完全没料，就写「今天没有值得说的」，不要凑数
- 任何拿不准的信息标「未证实」

## 验收清单

出稿前自查：

- [ ] 每条新闻都有来源域名
- [ ] 每个星数都能在采集结果里找到
- [ ] 没有「值得关注」「意义重大」这类空话
- [ ] 篇幅没超
- [ ] 推送失败时有降级，不是静默失败

## 依赖清单

| 依赖 | 用途 | 必需性 | 怎么检查 |
|---|---|---|---|
| Node.js 18+ | 采集 / 推送 / 自检脚本 | 用脚本就必需；纯 agent 模式可省 | `preflight` |
| 网络 → `api.github.com` | 搜仓库、补全星数 | 必需 | `preflight` |
| 网络 → `github.com` | 抓 trending | 可选，失败自动降级到 API 快照 | `preflight` |
| GitHub token | 限额 60 → 5000 次/小时 | 可选 | `preflight` 显示认证状态 |
| 宿主工具 `web_search` / `web_fetch` | 搜新闻、页面兜底 | 必需（新闻靠它） | 由 agent 宿主提供 |
| OneBot v11 WebSocket | 推 QQ | 可选；`delivery=qq` 时必需 | `preflight --qq` |
| `bash` + `curl` | 配 token、手动验证接口 | 可选 | — |

没有 Node 也能用：跳过两个脚本，GitHub 部分用 `web_fetch` 抓 trending 自行解析，
推送只用 `chat` 模式。
