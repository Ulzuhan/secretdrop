import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { KaiCorpFooter } from "@/components/kaicorp-footer";
import { KaiCorpHeader } from "@/components/kaicorp-header";
import { SignOut } from "@/components/sign-out";
import { currentAccount } from "@/lib/auth";

const display = Space_Grotesk({ variable: "--font-display", weight: ["500", "700"], subsets: ["latin"] });
const sans = Inter({ variable: "--font-sans", weight: ["400", "500"], subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", weight: ["400", "500"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SecretDrop — Share Secrets Securely",
  description: "Encrypt, share, self-destruct. Your secrets burn after reading.",
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
        <KaiCorpHeader app="SecretDrop">{account && <SignOut email={account.email} />}</KaiCorpHeader>
        {children}
        <KaiCorpFooter current="secretdrop" />
      </body>
    </html>
  );
}