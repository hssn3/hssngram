// Runs the API server and the Vite dev server together, with no extra dependency.
import { spawn } from 'node:child_process';
import process from 'node:process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const targets = [
  { name: 'server', color: '\u001b[36m' },
  { name: 'web', color: '\u001b[35m' },
];

const children = targets.map(({ name, color }) => {
  const child = spawn(npm, ['run', `dev:${name}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: process.env,
  });

  const prefix = `${color}[${name}]\u001b[0m `;
  const pipe = (stream, out) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});

const shutdown = () => {
  for (const child of children) child.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
