---
name: devin-search
description: >-
  用本机 devin-search MCP 的 devin_code_search 定位仓库里的实现。文件或符号未知时先调用它，
  再按返回路径用 Read 核对。未登录时工具会返回登录链接，把链接给用户点击。不要代为执行 devin-login。
when-to-use: 不知道代码在哪、定位实现、跨文件流程、devin_code_search、Devin 代码搜索
user-invocable: false
---

# Devin 代码搜索

位置不明时先调用 MCP 工具 `devin_code_search`，不要先全库搜索。

- `query`：英文描述要找的行为，必要时夹业务词。一次只问一个问题。
- `project_path`：仓库根目录的绝对路径。
- `include_snippets` 保持默认 false。拿到路径和行号后，用宿主自己的 Read 打开文件核对，再改代码或下结论。
- 返回是线索，不是已经核实的解释。

未登录或会话过期时，工具结果里会有一条 `https://app.devin.ai/auth/cli/continue` 链接。把这条链接原样发给用户，让用户点击。登录进程已经在 MCP 里等回调，不要自己执行 `devin-login`，不要在终端里等待，不要索要授权码，也不要让用户把授权码贴进对话。用户说浏览器已接受回调之后，再调用原来的搜索。链接没有出来时，才请用户在自己的终端运行 `devin-login`。

不要用这个工具改文件，也不要搜索 `project_path` 以外的目录。

公开网页用 `devin_web_search`。不传 `max_results` 时默认 10 条，最多 10 条。不要把密钥或私有源码放进查询。退出登录是用户自己在终端执行 `devin-logout`，不要代为执行。
