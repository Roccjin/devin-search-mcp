# devin-search-mcp

[English](README.en.md)

本机 stdio MCP。它用你自己的 Devin 会话，在一个本地目录里做只读代码搜索，也可以做公开网页搜索。登录只在终端里执行 `devin-login`，授权码不进入对话。

查询和筛过的代码片段会送到 Devin / Windsurf 云端。搜索范围限制在调用时传入的目录。这个服务不读 Windsurf 的数据库，也不和 Pi、DSH 共用凭据文件。

## 环境

需要 Node.js `>=22.19`。Linux、macOS、Windows 都能跑。Windows 上的打开浏览器、凭据读写和仓库读取已经在 Windows Node 24.17.0 上实测过，见下方「平台」。

## 安装

npm 上的包名是 `devin-local-search-mcp`。名字 `devin-search-mcp` 已被另一个无关项目占用。

```bash
npm install -g devin-local-search-mcp
```

全局安装后有三条命令：`devin-local-search-mcp`（MCP 服务）、`devin-login`、`devin-logout`。

## 给 AI 的安装提示词

把下面整段交给当前 agent。它只改这个 agent 自己的 MCP 配置和技能目录。

```text
请安装并配置 devin-local-search-mcp，这是本机 Devin 代码搜索的 stdio MCP。

1. 确认 Node.js >= 22.19。不够就停下来告诉我，不要换一台低版本继续。
2. 执行 npm install -g devin-local-search-mcp。
3. 用 `npm root -g` 找到全局包目录，把其中的 skills/devin-search 复制到当前 agent 的 skills 目录（Grok：~/.grok/skills/devin-search；Codex：~/.codex/skills/devin-search；Claude Code：~/.claude/skills/devin-search）。按当前这个 agent 只复制一份。
4. 只给当前 agent 增加 MCP 服务，名字用 devin-search。命令优先用全局命令 devin-local-search-mcp，不要写死某个人的家目录。Windows 上如果宿主拉不起 npm 的 .cmd，就改成 command=node，args 指向全局包里的 dist/server.js。
   - Grok：写入 ~/.grok/config.toml 的 [mcp_servers.devin-search]，default_tools_approval_mode = "approve"，enabled = true。
   - Codex：写入 ~/.codex/config.toml 的同名表。
   - Claude Code：写入 ~/.claude.json 的 mcpServers.devin-search。
5. 不要执行 devin-login，不要等待登录回调，也不要向我索要授权码。装完后告诉我在自己的终端运行 devin-login。
6. 不要改别的 MCP，不要打印凭据。
```

## 手动配置

Grok 的 `~/.grok/config.toml`：

```toml
[mcp_servers.devin-search]
command = "devin-local-search-mcp"
default_tools_approval_mode = "approve"
enabled = true
```

Codex 使用 `~/.codex/config.toml` 里的同名表。Claude Code 的 `~/.claude.json`：

```json
{
  "mcpServers": {
    "devin-search": {
      "command": "devin-local-search-mcp"
    }
  }
}
```

技能在包内的 `skills/devin-search/SKILL.md`。复制到：

- `~/.grok/skills/devin-search/`
- `~/.codex/skills/devin-search/`
- `~/.claude/skills/devin-search/`

改完配置后重新打开对应的 agent，新工具才会出现。

## 命令

```bash
devin-login              # 本机浏览器回调
devin-login --code       # 没有桌面时，在终端粘贴授权码
devin-login status       # 查看是否登录，不打印令牌
devin-logout             # 删除本机会话
```

在自己的终端运行 `devin-login`。它会打开浏览器，并在这个终端里等待回调。没有桌面时才用 `devin-login --code`。

凭据在 `~/.config/devin-search/credentials.json`。父目录可用绝对路径 `DEVIN_SEARCH_CONFIG_HOME` 覆盖。Windows 上也是用户主目录下的 `.config`，不是 `%APPDATA%`。

## 工具

| 工具 | 作用 |
|---|---|
| `devin_code_search` | `query`、`project_path` 必填。`max_turns` 为 1–6，默认 6。`include_snippets` 默认 false |
| `devin_status` | 是否登录、何时过期。不返回令牌 |
| `devin_web_search` | 默认注册。`max_results` 为 1–10，默认 10。`DEVIN_WEB_SEARCH=0` 时不注册 |

未登录时，状态、代码搜索和网页搜索会在这个 MCP 进程里开始浏览器登录，并立刻返回可点击的链接。模型把链接交给用户，不要再跑 `devin-login`，也不要等待回调。用户点完链接后再调用原来的工具。浏览器打不开时设置 `DEVIN_LOGIN_OPEN=0`，链接仍然返回。

## 平台

| | Linux | macOS | Windows |
|---|---|---|---|
| 打开登录页 | `xdg-open` | `open` | `powershell.exe Start-Process`。WSL 也走这条 |
| 凭据权限 | 目录 `0700`，文件 `0600` | 与 Linux 相同 | 模式位不是保密边界，目录 fsync 会跳过 |
| 读仓库文件 | 使用 `O_NOFOLLOW` | 使用 `O_NOFOLLOW` | 该常量不存在，退化为普通只读打开。符号链接仍先用 `lstat` 拒绝 |

在这台机器的 Windows 主机上，用 Node 24.17.0 实测过：凭据写入、读回和删除，以及 `readfile`、`rg`、`ls`，还有 `devin-login status` 在未登录时的退出。当前 Windows 账户不能创建符号链接（`EPERM`），所以链接拒绝没有在 Windows 上实测。macOS 与 Linux 共用 POSIX 路径，浏览器用 `open`；这次没有在 macOS 上跑。

## 许可与来源

本项目使用 MIT 许可，文本和 [dsh-devin-search](https://github.com/mimimaster/dsh-devin-search) 的许可同一类：保留版权声明和许可声明，软件按「原样」提供。本仓库的 `LICENSE` 同时写了本项目、dsh-devin-search 和协议片段所来自的 Piwin。

检索循环、PKCE 和只读沙箱是对照 [mimimaster/dsh-devin-search](https://github.com/mimimaster/dsh-devin-search) 的 `4fc16d2` 改成的本机 stdio MCP 和命令行。协议字段编号还来自该项目所改编的 Piwin。本地改动记在 `NOTICE`。
