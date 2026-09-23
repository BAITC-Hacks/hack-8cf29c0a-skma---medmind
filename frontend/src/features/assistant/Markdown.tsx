import { Link } from 'react-router-dom';
import { parseMarkdown, type Inline } from './model';

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'bold' ? (
          <strong key={i} className="font-semibold text-text-primary">{part.text}</strong>
        ) : part.type === 'code' ? (
          <code key={i} className="rounded-md bg-page-bg px-1.5 py-0.5 font-mono text-[0.85em]">{part.text}</code>
        ) : part.type === 'link' ? (
          <Link key={i} to={part.href} className="rounded text-accent-text underline underline-offset-4 hover:text-accent-hover active:text-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">{part.text}</Link>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Ответ модели как React-элементы — без HTML-инъекций. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-6">
      {parseMarkdown(text).map((block, i) => {
        if (block.type === 'h') return <p key={i} className="font-semibold"><InlineText parts={block.inline} /></p>;
        if (block.type === 'p') return <p key={i}><InlineText parts={block.inline} /></p>;
        const List = block.type === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i} className={`space-y-1 pl-5 ${block.type === 'ul' ? 'list-disc' : 'list-decimal'}`}>
            {block.items.map((item, j) => <li key={j}><InlineText parts={item} /></li>)}
          </List>
        );
      })}
    </div>
  );
}
