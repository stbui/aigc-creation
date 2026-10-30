import { spawnSync } from 'node:child_process';

const docker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
if (docker.error || docker.status !== 0) {
  console.error('无法执行 docker compose，请先安装 Docker Engine 与 Compose v2。');
  process.exit(1);
}

const checks = [
  {
    label: '本地开发编排',
    args: ['-f', 'docker-compose.yml', 'config', '--quiet'],
  },
  {
    label: '本地测试编排',
    args: ['-f', 'docker-compose.yml', '--profile', 'test', 'config', '--quiet'],
  },
  {
    label: '生产编排',
    args: ['-f', 'docker-compose.production.yml', 'config', '--quiet'],
    env: {
      BACKEND_ENV_FILE:
        process.env.BACKEND_ENV_FILE || './backend/.env.production.example',
    },
  },
];

for (const check of checks) {
  const result = spawnSync('docker', ['compose', ...check.args], {
    stdio: 'inherit',
    env: { ...process.env, ...check.env },
  });
  if (result.error || result.status !== 0) {
    console.error(`✗ ${check.label}校验失败`);
    process.exit(result.status || 1);
  }
  console.log(`✓ ${check.label}`);
}

console.log('Docker Compose 配置校验通过 ✓');
