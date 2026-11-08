import { Fragment } from 'react';

/**
 * Telegram-style lightweight markup:
 *   *bold*   _italic_   `code`   ~~strike~~   ||spoiler||
 * Rendered as React nodes, never as raw HTML.
 */
export function renderRichText(input: string): React.ReactNode[] {
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|~~[^~\n]+~~|\|\|[^|\n]+\|\|)/g;
  const parts = input.split(pattern).filter((part) => part !== '');
  let key = 0;

  return parts.map((part) => {
    const render = (node: React.ReactNode) => <Fragment key={key++}>{node}</Fragment>;

    if (part.length > 2) {
      if (part.startsWith('*') && part.endsWith('*')) {
        return render(<strong>{part.slice(1, -1)}</strong>);
      }
      if (part.startsWith('_') && part.endsWith('_')) {
        return render(<em>{part.slice(1, -1)}</em>);
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return render(<code className="rich-code">{part.slice(1, -1)}</code>);
      }
      if (part.startsWith('~~') && part.endsWith('~~')) {
        return render(<s>{part.slice(2, -2)}</s>);
      }
      if (part.startsWith('||') && part.endsWith('||')) {
        return render(<span className="spoiler">{part.slice(2, -2)}</span>);
      }
    }

    return render(part);
  });
}
