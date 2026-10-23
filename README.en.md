# devin-search-mcp

[中文](README.md)

A local stdio MCP. It uses your own Devin session to search one local directory read-only, and it can search the public web. Login runs only in your terminal as `devin-login`. Authorization codes never enter the chat.

Queries and filtered snippets are sent to the Devin / Windsurf cloud. The search stays inside the directory passed to the call. This service does not read Windsurf's database, and it does not share credential files with Pi or DSH.

## Requirements

Node.js `>=22.19`. It runs on Linux, macOS, and Windows. Browser launch, credential storage, and repository reads were exercised on Windows Node 24.17.0. See Platforms below.

## Install

The npm package name is `devin-local-search-mcp`. The name `devin-search-mcp` already belongs to an unrelated project.

```bash
npm install -g devin-local-search-mcp
```

A global install provides `devin-local-search-mcp` (the MCP server), `devin-login`, and `devin-logout`.

## Prompt for an AI installer

Paste this whole block to the current agent. It should touch only this agent's MCP config and skills directory.

```text
Install and configure devin-local-search-mcp, a local stdio MCP for Devin code search.

1. Require Node.js >= 22.19. If it is older, stop and tell me. Do not continue on an older runtime.
2. Run npm install -g devin-local-search-mcp.
3. Locate the global package with `npm root -g` and copy its skills/devin-search directory into the current agent's skills directory (Grok: ~/.grok/skills/devin-search; Codex: ~/.codex/skills/devin-search; Claude Code: ~/.claude/skills/devin-search). Copy it only for the agent you are running in.
4. Add one MCP server named devin-search. Prefer the global command devin-local-search-mcp. Do not hard-code a home directory. On Windows, if the host cannot spawn the npm .cmd shim, set command to node and point args at dist/server.js inside the global package.
   - Grok: ~/.grok/config.toml, table [mcp_servers.devin-search], default_tools_approval_mode = "approve", enabled = true.
   - Codex: the same table in ~/.codex/config.toml.
   - Claude Code: mcpServers.devin-search in ~/.claude.json.
5. Do not run devin-login, do not wait on the login callback, and do not ask me for an authorization code. When finished, tell me to run devin-login in my own terminal.
6. Do not change other MCP servers and do not print credentials.
```

## Manual setup

Grok, `~/.grok/config.toml`:

```toml
[mcp_servers.devin-search]
command = "devin-local-search-mcp"
default_tools_approval_mode = "approve"
enabled = true
```

Codex uses the same table in `~/.codex/config.toml`. Claude Code, `~/.claude.json`:

```json
{
  "mcpServers": {
    "devin-search": {
      "command": "devin-local-search-mcp"
    }
  }
}
```

The skill file is `skills/devin-search/SKILL.md` inside the package. Copy it to:

- `~/.grok/skills/devin-search/`
- `~/.codex/skills/devin-search/`
- `~/.claude/skills/devin-search/`

Restart the agent after changing its config. The new tools show up in the new session.

## Commands

```bash
devin-login              # browser callback on this machine
devin-login --code       # no desktop: paste the code in this terminal
devin-login status       # login state, no token
devin-logout             # delete the local session
```

Run `devin-login` in your own terminal. It opens a browser and waits for the callback there. Use `devin-login --code` only when there is no desktop.

Credentials are stored at `~/.config/devin-search/credentials.json`. Set `DEVIN_SEARCH_CONFIG_HOME` to an absolute path to move the parent directory. On Windows this is still `.config` under the user profile, not `%APPDATA%`.

## Tools

| Tool | Role |
|---|---|
| `devin_code_search` | `query` and `project_path` are required. `max_turns` is 1–6, default 6. `tree_depth` is 1–6, default 3, and shrinks if the map exceeds about 250KB. A literal probe adds relevant paths and hotspot directories before the model runs. If the model returns no parseable paths, the search retries up to two likely subdirectories. Unused result slots are then filled from the literal patterns the model already ran, labeled `[grep expanded]`. `exclude_paths` skips extra path fragments. `max_results` is 1–8, default 8. `include_snippets` defaults to false. Literal search uses the bundled ripgrep |
| `devin_status` | Whether the session is logged in, and when it expires. No token |
| `devin_web_search` | Registered by default. `max_results` is 1–10, default 10. Set `DEVIN_WEB_SEARCH=0` to skip it |

When logged out, status, code search, and web search start a browser login in the MCP process and return a clickable link immediately. The model shows that link and does not run `devin-login` or wait. After the browser accepts the callback, call the tool again. Set `DEVIN_LOGIN_OPEN=0` when a browser cannot be opened; the link is still returned.

## Platforms

| | Linux | macOS | Windows |
|---|---|---|---|
| Open the login page | `xdg-open` | `open` | `powershell.exe Start-Process`. WSL uses this path too |
| Credential modes | directory `0700`, file `0600` | same as Linux | mode bits are not a confidentiality boundary; directory fsync is skipped |
| Read repository files | `O_NOFOLLOW` | `O_NOFOLLOW` | the constant is absent, so the open is a normal read. Symlinks are still rejected with `lstat` first |

On this machine's Windows host, Node 24.17.0 wrote, reread, and deleted a credential file, then `readfile`, `rg`, and `ls` succeeded. `devin-login status` exited cleanly while logged out. The Windows account cannot create symlinks (`EPERM`), so symlink rejection was not exercised there. macOS shares the POSIX path with Linux and uses `open` for the browser; it was not run this time.

## License and attribution

This project is MIT, the same terms as [dsh-devin-search](https://github.com/mimimaster/dsh-devin-search): keep the copyright and permission notice, and the software is provided as is. `LICENSE` names this project, dsh-devin-search, and the Piwin sources the protocol portions were adapted from.

The search loop, PKCE flow, and read-only sandbox were adapted from [mimimaster/dsh-devin-search](https://github.com/mimimaster/dsh-devin-search) at `4fc16d2` into this local stdio MCP and CLI. Protocol field numbers also come from the Piwin code that project adapted. Local changes are listed in `NOTICE`.
