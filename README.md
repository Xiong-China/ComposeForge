# ComposeForge

将 `docker run` 命令转换为 `docker-compose.yml`，以及格式化 / 校验 Compose YAML 的纯前端工具。所有处理都在浏览器本地完成，不上传任何数据。

## 功能

- **docker run 转 Compose**：解析端口、挂载、环境变量、网络、重启策略、健康检查、资源限制等常用参数，输出 Compose V2 格式的 YAML；对无法直接等价转换的参数给出说明。
- **Compose 格式化**：统一缩进（2 / 4 空格）、保留注释、校验 YAML 语法，并提示缺少 `image`/`build`、Compose V2 不再需要 `version` 等常见问题。

## 本地开发

```bash
npm install
npm run dev
```

构建：

```bash
npm run build   # 产物在 dist/
npm run preview
```

## 部署到 Cloudflare Pages

**方式一：连接 Git 仓库（推荐）**

1. 在 Cloudflare Dashboard 进入 **Workers & Pages → Create → Pages → Connect to Git**，选择本仓库。
2. 构建配置：
   - Framework preset：`Vite`
   - Build command：`npm run build`
   - Build output directory：`dist`
   - Root directory：`/`
3. 保存并部署。后续推送到主分支会自动重新部署。

**方式二：Wrangler CLI**

```bash
npm run build
npx wrangler pages deploy dist --project-name composeforge
```

仓库中的 `wrangler.toml` 已配置 `pages_build_output_dir`，直接运行 `npx wrangler pages deploy dist` 也可以。

> 站点为纯静态资源，无需 Worker、环境变量或绑定。
