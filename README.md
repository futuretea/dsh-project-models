# dsh-project-models

按项目给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的主 agent 和 sub-agent 分别指定模型。在项目 A 里开会话，主 agent 和 sub-agent 自动用 A 的模型；换到项目 B 自动换成 B 的，不用每次手选。

## 安装

```sh
git clone https://github.com/futuretea/dsh-project-models.git
cd dsh-project-models && pnpm install && pnpm build
dsh plugin --profile web add "$(pwd)"
```

也可以 `pnpm pack` 后安装生成的 tarball。支持 dsh `>=0.2.2-rc.1 <0.3.0`。

## 用法

### 配置页

Web UI 侧栏 **插件 → 已安装插件 → dsh-project-models**，页面下方的「项目模型」里：

- 「添加项目」填项目目录（绝对路径或 `~/...`），分别选主智能体和子智能体的模型；模型支持推理强度时旁边会出现强度下拉框。
- 点「保存」写回当前 profile 的 `cordis.patch.yml`；路径为空、不是绝对路径或与其他项目重复时不能保存。

### 命令

在会话输入框里用 `/project-models`，改动写回同一份配置：

| 命令 | 作用 |
|---|---|
| `/project-models` | 查看当前项目的配置和本会话正在用的模型 |
| `/project-models main <provider>/<model> [effort]` | 设置主 agent 模型，当前会话从下一步起立即生效 |
| `/project-models sub <provider>/<model> [effort]` | 设置 sub-agent 模型 |
| `/project-models remember` | 把本会话当前模型记为该项目的主模型 |
| `/project-models unset main\|sub` | 删除一项 |
| `/project-models forget` | 删除该项目的全部配置 |

`provider` 是 dsh 里的提供方 id（如 `openai`、`moonshotai`、`zai` 或自定义提供方），model id 里可以带 `/`。命令会检查提供方已注册、模型可解析、推理强度在该模型声明的范围内。

也可以直接编辑 profile 的 `cordis.patch.yml`：

```yaml
- id: project-models
  config:
    projects:
      - path: ~/dev/project-a
        main: { provider: openai, model: gpt-astra }
        sub: { provider: openai, model: gpt-sol }
      - path: ~/dev/project-b
        main: { provider: moonshotai, model: kimi-k3, reasoningEffort: high }
        sub: { provider: zai, model: glm-5.3 }
```

## 规则

- 按会话的根目录匹配项目：取路径最长的那条规则；路径支持 `~`，符号链接会解析成真实路径。sub-agent 按它所属的顶层会话的目录匹配。
- 只作用于新建的会话和 sub-agent；恢复的会话保留它已记录的模型。
- sub-agent 的模型优先级：委派时显式指定的模型（委派调用参数或 `tool-subagent` 的 `agentOptions`）> `sub` > dsh 默认（沿用父 agent）。
- 没写 `main` 时用 dsh 的默认模型；没匹配到任何项目时插件什么都不做。

## 已知限制

- 配置页只在 Web UI 里有；其他界面用命令或配置文件。
- 配置页的浏览器端代码用 esbuild 按 dsh 客户端模块格式自行打包，依赖 dsh Web 壳提供的共享模块（react、`dsh-client-ui-primitives` 等）；dsh 升级改变这些接口时，配置页最先需要跟着改。
- 用 `--patch` 或 `$DSH_HOME/cordis.patch.yml` 写的本插件配置优先级高于 profile，此时命令无法保存，会提示改配置文件。
- 新建项目规则时，项目路径取会话目录向上最近的含 `.git` 的目录，用的是 dsh 进程所在机器的文件系统；远程工作区里会退化为会话目录本身。

## 开发

```sh
pnpm install
pnpm typecheck  # Host 端与浏览器端类型检查
pnpm test       # 构建后运行单元测试、配置页逻辑测试和端到端测试
```

端到端测试用本地 mock 模型服务和真实的 `dsh headless`，通过 `dsh plugin add` 装进临时 profile，验证主模型、子模型、显式子模型优先、命令写回配置。不需要任何 API key，也不访问外网。
