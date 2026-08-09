"use client";

import { type CSSProperties, useEffect } from "react";

// Vangt fouten die src/app/error.tsx niet kan vangen: alles wat in de root-layout
// zelf stukgaat (nonce-header, fontregistry, preference-boot). Deze component
// vervangt de layout en rendert daarom haar eigen <html>/<body> en kan geen
// providers, thema-attributen of globals.css veronderstellen — vandaar inline
// styles in de merkkleuren, net als public/offline.html.
const shell: CSSProperties = {
  minHeight: "100dvh",
  margin: 0,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  padding: "2rem",
  background: "#07091a",
  color: "#dce5ff",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="nl">
      <body style={shell}>
        <main style={{ maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.35rem", margin: "0 0 0.5rem", fontWeight: 600 }}>Er ging iets mis</h1>
          <p style={{ margin: "0 0 1.5rem", color: "#94a3c7", lineHeight: 1.55 }}>De pagina kon niet worden geladen.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.65rem 1.4rem",
              border: "1px solid rgb(128 139 255 / 35%)",
              borderRadius: "999px",
              background: "rgb(22 155 255 / 18%)",
              color: "#dce5ff",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Opnieuw proberen
          </button>
        </main>
      </body>
    </html>
  );
}
