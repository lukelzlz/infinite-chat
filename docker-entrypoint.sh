#!/bin/bash

# 启动脚本

echo "🚀 Starting infinite-chat..."

# 检查环境变量
if [ -z "$SILICONFLOW_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  Warning: No API key set. Set SILICONFLOW_API_KEY or OPENAI_API_KEY"
fi

# 启动服务
exec node dist/index.js
