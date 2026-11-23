"use client";

import { Children, createContext, useContext, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

/** The line in the Markdown of the checklist item being drawn, for its box; null outside one. */
const ChecklistLine = createContext<number | null>(null);

type CheckHandler = (line: number, checked: boolean) => void;
const CheckContext = createContext<{ onCheck?: CheckHandler; disabled: boolean }>({ disabled: true });

function ChecklistBox({ checked }: { checked: boolean }) {
  const line = useContext(ChecklistLine);
  const { onCheck, disabled } = useContext(CheckContext);
  const editable = line !== null && onCheck !== undefined && !disabled;
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!editable}
      onChange={(event) => (editable ? onCheck(line, event.target.checked) : undefined)}
      className="mt-[0.3em] h-4 w-4 shrink-0 accent-accent disabled:opacity-100"
    />
  );
}

const COMPONENTS: Components = {
  // A checklist item: its box and text in one label, so the text names the box and ticks it.
  li({ node, children, className, ...props }) {
    if (!className?.includes("task-list-item")) {
      return (
        <li className={className} {...props}>
          {children}
        </li>
      );
    }
    const [box, ...rest] = Children.toArray(children);
    const checked = node?.children.some((child) => child.type === "element" && child.tagName === "input" && child.properties.checked === true) ?? false;
    return (
      <ChecklistLine.Provider value={node?.position?.start.line ?? null}>
        <li className={className} {...props}>
          <label className={cn("flex items-start gap-2", checked && "[&>span]:text-muted [&>span]:line-through")}>
            {box}
            <span className="min-w-0 [overflow-wrap:anywhere]">{rest}</span>
          </label>
        </li>
      </ChecklistLine.Provider>
    );
  },
  input({ node, checked, type, ...props }) {
    void node; // Kept off the element.
    if (type === "checkbox") return <ChecklistBox checked={checked === true} />;
    return <input type={type} checked={checked} {...props} />;
  },
  // Links written in a description go to other sites, in a new tab. One whose address could run
  // code arrives without it, and stays text.
  a({ node, href, children, ...props }) {
    void node; // Kept off the element.
    if (!href) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
        {children}
      </a>
    );
  },
  // A wide table or block of code scrolls sideways, so the keyboard can reach it to scroll it.
  table({ node, ...props }) {
    void node; // Kept off the element.
    return <table tabIndex={0} {...props} />;
  },
  pre({ node, ...props }) {
    void node; // Kept off the element.
    return <pre tabIndex={0} {...props} />;
  },
};

/**
 * Markdown as the app shows it (#433): headings, lists, checklists, links, tables and code. Raw
 * HTML shows as the text it is, and links that could run code are removed. With `onCheck`, the
 * checklist boxes tick and untick; it gets the item's line in `text` (1-based).
 */
export function MarkdownText({ text, onCheck, disabled = false, className }: { text: string; onCheck?: CheckHandler; disabled?: boolean; className?: string }): ReactNode {
  return (
    <CheckContext.Provider value={{ onCheck, disabled }}>
      <div className={cn("markdown", className)}>
        <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
          {text}
        </Markdown>
      </div>
    </CheckContext.Provider>
  );
}
