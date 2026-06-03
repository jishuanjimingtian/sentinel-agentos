---
name: agent-browser
description: 面向 AI 智能体优化的无头浏览器自动化命令行工具，支持可访问性树快照与基于引用（ref）的元素选取
metadata: {"clawdbot":{"emoji":"🌐","requires":{"commands":["agent-browser"]},"homepage":"https://github.com/vercel-labs/agent-browser"}}
---

# Agent Browser 技能

利用可访问性树快照实现快速浏览器自动化，通过引用（ref）确保元素选取的确定性。

## 为何选用此工具而非内置浏览器工具

**选用 agent-browser 的场景：**
- 自动化多步骤工作流
- 需要确定性的元素选取
- 性能至关重要
- 处理复杂的单页应用（SPA）
- 需要会话隔离

**选用内置浏览器工具的场景：**
- 需要截图或 PDF 进行分析
- 需要视觉检查
- 需要集成浏览器扩展

## 核心工作流

```bash
# 1. 导航并生成快照
agent-browser open https://example.com
agent-browser snapshot -i --json

# 2. 从 JSON 中解析 refs，然后执行交互
agent-browser click @e2
agent-browser fill @e3 "text"

# 3. 页面变更后重新生成快照
agent-browser snapshot -i --json
```

## 关键命令

### 导航
```bash
agent-browser open <url>
agent-browser back | forward | reload | close
```

### 快照（务必始终使用 `-i --json`）
```bash
agent-browser snapshot -i --json          # 仅交互式元素，JSON 输出
agent-browser snapshot -i -c -d 5 --json  # + 紧凑格式，深度限制
agent-browser snapshot -s "#main" -i      # 限定于指定 CSS 选择器范围
```

### 交互（基于 ref）
```bash
agent-browser click @e2
agent-browser fill @e3 "text"
agent-browser type @e3 "text"
agent-browser hover @e4
agent-browser check @e5 | uncheck @e5
agent-browser select @e6 "value"
agent-browser press "Enter"
agent-browser scroll down 500
agent-browser drag @e7 @e8
```

### 获取信息
```bash
agent-browser get text @e1 --json
agent-browser get html @e2 --json
agent-browser get value @e3 --json
agent-browser get attr @e4 "href" --json
agent-browser get title --json
agent-browser get url --json
agent-browser get count ".item" --json
```

### 检查状态
```bash
agent-browser is visible @e2 --json
agent-browser is enabled @e3 --json
agent-browser is checked @e4 --json
```

### 等待
```bash
agent-browser wait @e2                    # 等待元素出现
agent-browser wait 1000                   # 等待指定毫秒数
agent-browser wait --text "Welcome"       # 等待文本出现
agent-browser wait --url "**/dashboard"   # 等待 URL 匹配
agent-browser wait --load networkidle     # 等待网络空闲
agent-browser wait --fn "window.ready === true"
```

### 会话（隔离的浏览器实例）
```bash
agent-browser --session admin open site.com
agent-browser --session user open site.com
agent-browser session list
# 或通过环境变量：AGENT_BROWSER_SESSION=admin agent-browser ...
```

### 状态持久化
```bash
agent-browser state save auth.json        # 保存 cookies / 存储数据
agent-browser state load auth.json        # 加载（跳过登录流程）
```

### 截图与 PDF
```bash
agent-browser screenshot page.png
agent-browser screenshot --full page.png
agent-browser pdf page.pdf
```

### 网络控制
```bash
agent-browser network route "**/ads/*" --abort           # 屏蔽请求
agent-browser network route "**/api/*" --body '{"x":1}'  # 模拟响应
agent-browser network requests --filter api              # 查看请求日志
```

### Cookies 与存储
```bash
agent-browser cookies                     # 获取全部 cookies
agent-browser cookies set name value
agent-browser storage local key           # 获取 localStorage
agent-browser storage local set key val
```

### 标签页与框架
```bash
agent-browser tab new https://example.com
agent-browser tab 2                       # 切换至第 2 个标签页
agent-browser frame @e5                   # 切换至 iframe
agent-browser frame main                  # 返回主文档上下文
```

## 快照输出格式

```json
{
  "success": true,
  "data": {
    "snapshot": "...",
    "refs": {
      "e1": {"role": "heading", "name": "Example Domain"},
      "e2": {"role": "button", "name": "Submit"},
      "e3": {"role": "textbox", "name": "Email"}
    }
  }
}
```

## 最佳实践

1. **始终使用 `-i` 标志** —— 仅聚焦于交互式元素  
2. **始终使用 `--json`** —— 更易于解析  
3. **等待页面稳定** —— 使用 `agent-browser wait --load networkidle`  
4. **保存认证状态** —— 使用 `state save/load` 跳过登录流程  
5. **使用会话隔离** —— 分离不同浏览器上下文  
6. **调试时使用 `--headed`** —— 可视化操作过程  

## 示例：搜索并提取内容

```bash
agent-browser open https://www.google.com
agent-browser snapshot -i --json
# AI 识别出搜索框为 @e1
agent-browser fill @e1 "AI agents"
agent-browser press Enter
agent-browser wait --load networkidle
agent-browser snapshot -i --json
# AI 识别出结果对应的 refs
agent-browser get text @e3 --json
agent-browser get attr @e4 "href" --json
```

## 示例：多会话测试

```bash
# 管理员会话
agent-browser --session admin open app.com
agent-browser --session admin state load admin-auth.json
agent-browser --session admin snapshot -i --json

# 用户会话（并行执行）
agent-browser --session user open app.com
agent-browser --session user state load user-auth.json
agent-browser --session user snapshot -i --json
```

## 安装

```bash
npm install -g agent-browser
agent-browser install                     # 下载 Chromium
agent-browser install --with-deps         # Linux：同时安装系统依赖
```

## 致谢

本技能由 Yossi Elkrief（[@MaTriXy](https://github.com/MaTriXy)）创建  

agent-browser CLI 工具由 [Vercel Labs](https://github.com/vercel-labs/agent-browser) 开发