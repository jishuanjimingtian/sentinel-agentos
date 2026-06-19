# Sentinel AgentOS — Product Hunt 发布材料清单

> 上次 coderev 已注册 Product Hunt（账号: 2749278679@qq.com, GitHub 登录），
> 本次为 AgentOS 单独创建产品页。

## 一、产品页信息

### 1. 名称
**Sentinel AgentOS**

### 2. Tagline（一句话）
```
Antivirus for AI Agents — deterministic Guard + memory + audit. One command install.
```

### 3. 描述（Product Hunt 正文）

> **AI Agents are powerful. They're also dangerous.**
>
> They hallucinate commands, delete files, leak secrets, and nobody can tell what happened after.
>
> Sentinel AgentOS is the world's first **Agent Operating System** — a deterministic safety layer that sits between any AI agent and your machine.
>
> **🛡️ Guard** — 9 dangerous command patterns + 16 sensitive file patterns + JSON/YAML validators. Catches `rm -rf /`, `sudo rm`, `:(){ :|:& };:` before they run. Zero LLM dependency.
>
> **🧠 Memory** — 3-layer memory (Working / Episodic / Semantic). Compresses, forgets, and retains the right things — like a human brain, not a vector dump.
>
> **📊 Audit** — Every tool call is logged with pre/post snapshots. Immutable JSONL. You always know what happened and why.
>
> **📈 Evaluator** — Quality scoring (0-100), implicit feedback, and improvement trends. You know if your agent is getting better or worse.
>
> **How it works:**
> ```bash
> npm install -g sentinel-agentos sentinel-agentos-plugin
> openclaw plugins install sentinel-agentos-plugin
> openclaw gateway restart
> # Done. Every agent tool call goes through Guard + Memory + Audit automatically.
> ```
>
> Open source. MIT. Framework-agnostic.

### 4. 链接
- **GitHub**: https://github.com/jishuanjimingtian/sentinel-agentos
- **npm**: https://www.npmjs.com/package/sentinel-agentos
- **Website**: (待建，可先指向 GitHub README)
- **Demo Video**: (待录)

### 5. 分类
- **Developer Tools**
- **Open Source**
- **AI & Machine Learning**

### 6. 标签
`ai`, `security`, `developer-tools`, `open-source`, `typescript`, `agent`, `guard`, `audit`

---

## 二、视觉素材

### 需要准备的图片/GIF

| # | 内容 | 说明 |
|---|------|------|
| **1** | **主图/Logo** | Sentinel AgentOS logo（待设计或基于现有风格） |
| **2** | **拦截截图** | CLI 展示 Agent 执行 `rm -rf /` 被 Guard 拦截，显示 "🚫 DENY" |
| **3** | **Dashboard/AuditLog** | `npx sentinel-agentos audit --limit 10` 输出 |
| **4** | **GIF Demo** | 3 步对比：无 AgentOS 危险操作 → 有 AgentOS 被拦截 → Audit 记录 |

### GIF 脚本（30 秒）

```
[0-10s]  裸 Agent: "让我删点文件... rm -rf /tmp/cache" → 显示执行
[10-20s] 有 AgentOS: "让我删点文件... rm -rf /tmp/cache" → 🚫 被拦截，显示原因
[20-30s] AgentOS 后台: AuditLog 记录 + Memory 更新 + Profile 评分
```

---

## 三、First Comment（创始人介绍）

```
Hey Product Hunt! 👋

I'm the developer behind Sentinel AgentOS.

The idea came after my AI agent nearly ran `rm -rf ./src` on a production codebase. I realized: we're giving LLMs full shell access and hoping for the best. Prompts like "please don't delete files" are wishes, not constraints.

Sentinel AgentOS is a deterministic safety net — not another prompt, not another LLM guard. It's a real OS layer with schema validation, risk scoring, file snapshots, and audit logging. 100% open source, MIT licensed.

Would love your feedback and questions!
```

---

## 四、发布当天操作清单

| 时间 | 动作 |
|------|------|
| **前 3 天** | 准备好上面所有素材、GIF 录好、页面填好 |
| **前 1 天** | 确认 npm 包可安装、README 链接有效 |
| **当天 8:00 AM PST** | Product Hunt 点击 Launch |
| **当天全天** | 回复评论、在社区转发 PH 链接 |

---

## 五、待办

- [ ] 设计/生成 AgentOS Logo
- [ ] 录制 30 秒对比 GIF
- [ ] 截图 audir dashboard（npx sentinel-agentos audit）
- [ ] 在 Product Hunt 创建产品页
- [ ] 填入描述、tagline、链接
- [ ] 准备 First Comment
- [ ] 选定 Launch 日期（建议周三）
