# sentinel-agentos-plugin — OpenClaw Plugin 提交清单

## 仓库

`github.com/clawdhub/openclaw-plugins`

## 包信息

| 项目 | 值 |
|------|------|
| 包名 | `sentinel-agentos-plugin` |
| 版本 | `1.0.1` |
| npm 账号 | `aisync`（2749278679@qq.com） |
| GitHub 账号 | `Annie-Bot`（2749278679@qq.com） |
| SSH Key | `C:\Users\十号\.ssh\github_anne` |

## 提交方式

1. Fork `clawdhub/openclaw-plugins`
2. 添加 plugin 元数据文件
3. 提 PR

## 元数据

```yaml
# plugins/sentinel-agentos-plugin.yml
id: sentinel-agentos-plugin
name: Sentinel AgentOS
description: deterministic Guard + layered Memory + auto Evaluation for OpenClaw agents
type: code-plugin
author: aisync
source: npm
package: sentinel-agentos-plugin
version: 1.0.1
tags:
  - security
  - guard
  - memory
  - audit
  - evaluation
```

## 注意事项

- 先等 npm 24h 锁定解除（6/15 14:40 后）发 `sentinel-agentos-plugin@1.0.1`
- ClawdHub 要求 `@owner/package-name` 格式，当前包名无 scope，可能需改包名
- 或直接提 PR，ClawdHub 支持无 scope 包名（检查是否有 `openclaw plugins install clawhub:sentinel-agentos-plugin` 路径）
