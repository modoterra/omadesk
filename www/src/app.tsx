import { InstallSnippet } from "./install-snippet";
import {
  asciiLogo,
  bindExample,
  displayName,
  githubRepo,
  installCommand,
  keys,
  lead,
  previewAlt,
  summonCommand,
} from "./site";

export function HomePage() {
  return (
    <div className="min-h-screen bg-desk-page text-desk-fg">
      <header className="border-b border-desk-border-soft bg-desk-bg">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-5">
          <p className="text-sm font-semibold">{displayName}</p>
          <a
            className="text-sm text-desk-accent transition hover:text-desk-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desk-accent"
            href={githubRepo}
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-14 px-5 py-16">
        <section>
          <pre
            aria-hidden="true"
            className="install-snippet-pre mx-auto w-fit overflow-x-auto text-[11px] leading-4 text-desk-muted sm:text-xs sm:leading-5"
          >
            {asciiLogo}
          </pre>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight sm:text-4xl">{displayName}</h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-desk-muted sm:text-lg sm:leading-8">
            {lead}
          </p>
        </section>

        <section aria-labelledby="install-heading">
          <h2 id="install-heading" className="text-sm font-semibold tracking-wide text-desk-fg">
            Install
          </h2>
          <div className="mt-4">
            <InstallSnippet code={installCommand} />
          </div>
          <p className="mt-4 text-sm leading-6 text-desk-muted">
            Summon with Super+D, or run the toggle directly. Super+Space stays the Omarchy menu.
          </p>
          <div className="mt-4">
            <InstallSnippet code={summonCommand} label="Summon" />
          </div>
          <div className="mt-4">
            <InstallSnippet code={bindExample} label="Bind" />
          </div>
        </section>

        <section aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="text-sm font-semibold tracking-wide text-desk-fg">
            Overlay
          </h2>
          <figure className="mt-4 overflow-hidden border border-desk-border bg-desk-bg">
            <img alt={previewAlt} className="block h-auto w-full" src="/preview.png" />
          </figure>
        </section>

        <section aria-labelledby="keys-heading">
          <h2 id="keys-heading" className="text-sm font-semibold tracking-wide text-desk-fg">
            Keys
          </h2>
          <div className="mt-4 overflow-x-auto border border-desk-border-soft">
            <table className="w-full min-w-xl border-collapse text-left text-sm">
              <caption className="sr-only">Keyboard shortcuts</caption>
              <thead className="bg-desk-bg text-desk-muted">
                <tr>
                  <th className="border-b border-desk-border-soft px-4 py-2 font-medium" scope="col">
                    Key
                  </th>
                  <th className="border-b border-desk-border-soft px-4 py-2 font-medium" scope="col">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((row) => (
                  <tr key={row.key}>
                    <th
                      className="border-b border-desk-border-soft px-4 py-2 font-normal text-desk-fg"
                      scope="row"
                    >
                      <kbd className="font-mono">{row.key}</kbd>
                    </th>
                    <td className="border-b border-desk-border-soft px-4 py-2 text-desk-muted">
                      {row.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="border-t border-desk-border-soft px-5 py-8 text-sm text-desk-muted">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>MIT · Modoterra</p>
          <p>
            <a
              className="text-desk-accent transition hover:text-desk-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desk-accent"
              href={`${githubRepo}/blob/main/LICENSE`}
              rel="noreferrer"
            >
              License
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
