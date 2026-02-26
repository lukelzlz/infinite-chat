# infinite-chat Dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制编译后的代码
COPY dist/ ./dist/

# 复制 webui 到 dist/webui（代码中路径是 ../webui，相对于 dist/adapters）
COPY src/webui/ ./dist/webui/

# 创建配置和数据目录
RUN mkdir -p /app/config /app/data

# 暴露端口
EXPOSE 3000

# 环境变量
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 启动命令
CMD ["node", "dist/test-start.js"]
