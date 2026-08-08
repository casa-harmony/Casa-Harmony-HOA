import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./providers";
import { ThemeProvider, themeScript } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import { ReviewLayer } from "@/components/review";

export const metadata: Metadata = {
  title: "Casa Harmony — Service Desk + ERP for HOAs",
  description:
    "Secure multi-tenant Service Desk + ERP for Homeowner Associations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          <Toaster />
          <ReviewLayer />
        </ThemeProvider>
      </body>
    </html>
  );
}
