import type { Metadata } from "next";

import { AssistentContent } from "./_components/assistent-content";

export const metadata: Metadata = {
  title: "AI-assistent",
  description: "Stel vragen over de organisatie en krijg antwoorden met een canvas vol cijfers en bronnen.",
};

export default function Page() {
  return <AssistentContent />;
}
