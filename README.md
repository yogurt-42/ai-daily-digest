# ai-daily-digest

一个可验证的每日 AI 早报 skill（skill 名 `ai-digest`）：**数字由脚本抓，模型只负责筛选和判断**。
抓不到就说抓不到，不编。

```
【行业新闻】
DeepSeek 全面开源推理框架 DeepInfer，称可优化推理吞吐与延迟、降低部署成本（stcn.com）
判断：自建推理的人该看部署细节，但开源的是框架，别指望马上降本。

【GitHub 热门】
cloudflare/security-audit-skill — 给 coding agent 的多阶段安全审计 skill — 今日 +1712 星（总计 34438 星）
点评：做 skill 的该学它的阶段划分和验证闭环，安全从业者能直接用。

【对你的意义】
最值得看 security-audit-skill：它的分段与独立验证，能直接套到下一个 skill。
```

完整样例见 [examples/sample-digest.txt](examples/sample-digest.txt)。

## 为什么做这个

「AI 日报」的失败方式几乎是一样的：模型读起来很懂，但星数是编的，来源是模糊的，
「重要」是它自己封的。

这个 skill 把顺序反过来：

| 常见做法 | 这里 |
|---|---|
| 模型搜索 + 模型总结 | 脚本先抓结构化数据，模型只改写和判断 |
| 每条一句通稿 | 每条强制一句判断（对谁意味着什么） |
| 没数据也要凑满 | 没料就写「今天没有值得说的」 |
| 出错静默 | trending 被墙、QQ 掉线都有降级路径 |

判断句是被约束的：≤40 字，不许写「值得关注」「意义重大」。

## 快速开始

```bash
# 0. 环境自检（第一次必跑）
node scripts/preflight.mjs          # 只输出到对话
node scripts/preflight.mjs --qq     # 计划推 QQ 时

# 1. 抓 GitHub 热门（输出 JSON）
node scripts/collect-github.mjs --limit 5

# 2. 可选：推送到 QQ（OneBot v11）
node scripts/send-qq.mjs --user <QQ号> --file digest.txt
```

然后让 agent 按 `SKILL.md` 的流程跑：搜新闻 → 筛选 → 成稿。

第一次调用时 agent 会问三个问题（关注倾向、篇幅语气、推送方式），
写进 `.ai-digest/config.json`，之后不再问。

## 它怎么应对失败

GitHub 网页在很多网络环境下不可达（DNS 被污染、TCP 超时），所以采集有三层：

1. 多个 GitHub IP 轮换 + 重试，传输截断时用已收到的前半页
2. 退回 `api.github.com` 搜索 + 本地每日星数快照做差
3. 连基线都没有 → 输出候选仓库，`starsToday` 标 `null`，成稿必须写「未知」

推送失败（OneBot 不在线）不会静默：退出码非 0，agent 应降级到对话内输出并说明。

## 依赖

| 依赖 | 必需性 | 说明 |
|---|---|---|
| Node.js 18+ | 用脚本时需要 | 纯 agent 模式可省 |
| `api.github.com` 可达 | 必需 | 搜索与补全星数 |
| `github.com` 可达 | 可选 | 抓 trending，不通自动降级 |
| GitHub token | 可选 | 限额 60 → 5000 次/小时 |
| `web_search` / `web_fetch`（宿主提供） | 必需 | 新闻来源 |
| OneBot v11 WebSocket | 可选 | 仅 `delivery=qq` 时需要 |

没有 Node 也能用：跳过脚本，用 `web_fetch` 抓 trending 自行解析，推送只用对话模式。

## 配置

```json
{
  "focus": ["大模型能力与定价", "agent / skill 工程"],
  "length": 1100,
  "tone": "偏工程，少形容词",
  "delivery": "chat",
  "qq": { "user_id": 0, "onebot_url": "ws://127.0.0.1:3001" }
}
```

配置默认写到当前目录的 `.ai-digest/config.json`（沙箱环境里 `~/.config` 可能不可写），
可用 `AI_DIGEST_CONFIG` 覆盖。

## 安装

- **OpenViking**：把本目录打包成 zip，`add_skill` 上传即可（SKILL.md 在最外层）
- **其他 agent**：把 `SKILL.md` 放到你的 skills 目录，`scripts/` 一并带上
- **定时**：交给 cron / systemd timer 调 `collect-github.mjs` + agent 生成步骤

## 目录

```
SKILL.md                      流程说明（agent 读这个）
references/output-format.md   输出模板 + 正反例
scripts/preflight.mjs         环境自检
scripts/collect-github.mjs    GitHub 数据采集
scripts/send-qq.mjs           QQ 推送（OneBot v11）
scripts/set-github-token.sh   token 安全写入（不回显、600）
examples/sample-digest.txt    真实输出样例
```

## English

A daily AI-digest skill that treats numbers as data, not prose: GitHub stars come
from scripts, the model only summarizes and judges. Missing data is reported as
missing and never invented. Every item must carry a ≤40-character takeaway.
Degrades gracefully when GitHub is unreachable or the chat bridge is offline,
and never fails silently.

## License

MIT
