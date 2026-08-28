import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { KaiCorpFooter } from "@/components/kaicorp-footer";
import { KaiCorpHeader } from "@/components/kaicorp-header";
import { KaiCorpAccountMenu } from "@/components/kaicorp-account-menu";
import { accountUrl } from "@/lib/oidc";
import { currentAccount } from "@/lib/auth";

const display = Space_Grotesk({ variable: "--font-display", weight: ["500", "700"], subsets: ["latin"] });
const sans = Inter({ variable: "--font-sans", weight: ["400", "500"], subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", weight: ["400", "500"], subsets: ["latin"] });

/**
 * The public origin, for canonical and social previews.
 *
 * It comes from SECRETDROP_PUBLIC_HOST, which already exists for the origin
 * check: no new variable, and whoever deploys this on their own domain gets
 * their own canonical without touching code. Unset, none is emitted — Next
 * would otherwise resolve relative URLs against localhost, and a canonical
 * pointing at localhost is worse than no canonical at all.
 */
const publicHost = process.env.SECRETDROP_PUBLIC_HOST?.trim();
const base = publicHost ? new URL(`https://${publicHost}`) : undefined;

const TITLE = "SecretDrop — one-time secrets, encrypted in your browser";
const DESCRIPTION =
  "Share a password once: encrypted before it leaves your browser, burned the moment it is read. The server only ever sees ciphertext. Self-hosted and open source.";

export const metadata: Metadata = {
  ...(base ? { metadataBase: base, alternates: { canonical: "/" } } : {}),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "SecretDrop",
    locale: "en_US",
    ...(base ? { url: "/", images: [{ url: "/og.jpg", width: 760, height: 475, alt: "SecretDrop: a secret that has already been read, with nothing left on the server" }] } : {}),
  },
  twitter: { card: "summary_large_image" },
};

/**
 * force-dynamic: la cabecera muestra la sesión, así que no puede prerenderizarse.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const account = await currentAccount();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <KaiCorpHeader app="SecretDrop">
          {/* El menú de cuenta es cromado común: lo reparte `sync-theme.sh` como la
              cabecera y el pie. Aquí había el correo en texto y un botón «Sign out» al
              lado, que era la cuarta forma distinta de resolver lo mismo entre las cinco
              aplicaciones. */}
          {account && (
            <KaiCorpAccountMenu email={account.email} accountUrl={accountUrl()} />
          )}
        </KaiCorpHeader>
        {children}
        <KaiCorpFooter current="secretdrop" />
      </body>
    </html>
  );
}