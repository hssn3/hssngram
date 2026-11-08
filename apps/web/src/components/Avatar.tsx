import { initials } from '../lib/format';

const gradients = [
  ['#5b4df0', '#9b5cf6'],
  ['#0ea5e9', '#22d3ee'],
  ['#f97316', '#f43f5e'],
  ['#10b981', '#34d399'],
  ['#8b5cf6', '#ec4899'],
  ['#f59e0b', '#f97316'],
  ['#06b6d4', '#3b82f6'],
];

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 100000;
  }
  return value;
}

type Props = {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  online?: boolean;
  className?: string;
};

export function Avatar({ name, src, size = 'md', online, className = '' }: Props) {
  const gradient = gradients[hash(name || '?') % gradients.length]!;
  const sizeClass = size === 'md' ? '' : size;

  return (
    <span
      className={`avatar ${sizeClass} ${className}`.trim()}
      style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
    >
      {src ? <img src={src} alt={name} loading="lazy" /> : initials(name || '؟')}
      {online ? <span className="dot" /> : null}
    </span>
  );
}
