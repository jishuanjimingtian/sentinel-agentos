# coderev 🧐

> AI-powered code review agent — 轻量、可扩展的代码审查 CLI 工具

[![npm version](https://img.shields.io/npm/v/@lishihao2749/coderev)](https://www.npmjs.com/package/@lishihao2749/coderev)
[![npm downloads](https://img.shields.io/npm/dt/@lishihao2749/coderev)](https://www.npmjs.com/package/@lishihao2749/coderev)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4%EF%B8%8F-pink)](https://github.com/sponsors/jishuanjimingtian)

---

## 快速开始

```bash
npm install -g @lishihao2749/coderev

# 审查一个 diff 文件
coderev review path/to/diff.patch

# 审查一个源文件
coderev review src/app.ts
```

## 审查规则

| 规则 | 严重级别 | 说明 |
|------|---------|------|
| 🔴 hardcoded-secrets | error | 检测硬编码密码/密钥 |
| 🔴 hooks-conditional | error | React Hook 条件调用 |
| 🔴 security-sql-injection | error | SQL 注入检测 |
| 🔴 security-xss | error | XSS 漏洞检测 |
| 🔴 security-eval | error | eval() 使用检测 |
| 🟡 console-log-leftover | warning | 遗留 console.log |
| 🟡 no-explicit-any | warning | 避免 any 类型 |
| 🟡 react-hooks-deps | warning | Hook 依赖数组 |
| 🟡 react-setstate-direct | warning | 直接修改 state |
| 🟡 perf-array-spread-render | warning | 渲染中创建新对象 |
| 🟡 security-redirect | warning | 未验证重定向 |
| 🟡 security-insecure-protocol | warning | 非 HTTPS 连接 |
| 🟡 security-loose-compare | warning | 松散比较 |
| 🔵 line-too-long | info | 行超长 |
| 🔵 trailing-whitespace | info | 行末空格 |
| 🔵 todo-leftover | info | 待办注释 |
| 🔵 perf-sync-xhr | info | 同步请求 |
| 🔵 perf-large-array | info | 大数组字面量 |

## 命令

```bash
coderev review <path>        # 审查代码
coderev fix <path>           # 自动修复问题
coderev hook                 # 安装 Git hook
coderev stats                # 审查统计看板
coderev config               # 配置管理
coderev cache                # 缓存管理
coderev init                 # 初始化项目配置
```

### 选项

- `--format json` — JSON 格式输出
- `--gl` — GitLab 集成模式
- `--all` — 批量审查所有 PR

## GitHub Actions 集成

在仓库添加 `.github/workflows/coderev-review.yml`，每次 PR 自动审查：

```yaml
# 见 .github/workflows/coderev-review.yml
```

## 贡献

欢迎 Issue 和 PR！请先看 [TODO.md](TODO.md) 了解开发计划。

## 路线图

详见 [ROADMAP.md](ROADMAP.md)

## 赞助

如果 coderev 对你有帮助，可以考虑赞助支持我的开发 ❤️

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor%20on%20GitHub-%E2%9D%A4%EF%B8%8F-pink?style=for-the-badge)](https://github.com/sponsors/jishuanjimingtian)

## License

MIT
