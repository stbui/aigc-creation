const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 12);

if (!supported) {
  console.error(`需要 Node >= 22.12.0，当前为 ${process.versions.node}`);
  process.exit(1);
}

console.log(`Node ${process.versions.node} ✓`);
