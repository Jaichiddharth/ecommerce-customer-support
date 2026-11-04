import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import ToasterProvider from "@/components/ToasterProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: "OmniFlow - WhatsApp & Omnichannel Admin UI",
  description: "Shopify Omnichannel WhatsApp Cloud API, Live Inbox, Automations & Analytics Hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.className} h-full antialiased`}
    >
      <body className="h-full w-full overflow-hidden bg-slate-50 text-slate-950 antialiased font-normal">
        <AuthProvider>{children}</AuthProvider>
        <ToasterProvider />
      </body>
    </html>
  );
}

