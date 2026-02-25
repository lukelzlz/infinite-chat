# Docker 镜像构建文件

FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制代码
COPY dist/ ./dist/
COPY src/webui/ ./dist/webui/

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "dist/index.js"]
