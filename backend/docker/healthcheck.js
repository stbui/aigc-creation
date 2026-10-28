#!/usr/bin/env node

/**
 * 容器就绪探针：调用 /health/ready，真实查询数据库。
 * 不用 curl，避免为了探针在生产镜像里额外安装系统包。
 */

const http = require('http');

const port = Number(process.env.PORT || 3001);
const prefix = (process.env.API_PREFIX || 'api/v1').replace(/^\/+|\/+$/g, '');
const path = `/${prefix}/health/ready`;

const request = http.get(
  { host: '127.0.0.1', port, path, timeout: 4000 },
  (response) => {
    response.resume();
    response.on('end', () => process.exit(response.statusCode === 200 ? 0 : 1));
  },
);

request.on('timeout', () => request.destroy(new Error('health check timeout')));
request.on('error', () => process.exit(1));
