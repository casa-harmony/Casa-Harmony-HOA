import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./providers";

export const metadata: Metadata = {
  title: "Casa Harmony AI",
  description:
    "Secure multi-tenant Service Desk + ERP for Homeowner Associations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
