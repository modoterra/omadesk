import { useState } from "react";

type Props = {
  code: string;
  label?: string;
};

/**
 * Copyable shell block for install and summon commands.
 */
export function InstallSnippet({ code, label = "Shell" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-hidden border border-desk-border bg-desk-fill">
      <div className="flex items-center justify-between border-b border-desk-border-soft px-4 py-2">
        <span className="text-xs tracking-wide text-desk-muted">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="border border-desk-border-soft bg-desk-bg px-2.5 py-1 text-xs text-desk-fg transition hover:border-desk-fg/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desk-accent"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="install-snippet-pre px-5 py-4 text-sm leading-7 text-desk-fg whitespace-pre-wrap"
        tabIndex={0}
      >
        {code}
      </pre>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
