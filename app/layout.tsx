import type { Metadata, Viewport } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import NativeRuntime from "./components/NativeRuntime";
import "./globals.css";
import InstallPrompt from './components/InstallPrompt';
import ServiceWorkerRegister from './components/ServiceWorkerRegister';


export const metadata: Metadata = {
  title: "Raydar - Solar Lead Management",
  description: "Professional solar lead management for door-knocking sales teams",
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Raydar',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true,
  themeColor: "#FFFFFF", viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased"
        style={{ userSelect: 'auto', WebkitUserSelect: 'auto' }}
      >
        <div className="native-viewport">
          <NativeRuntime />
          <ServiceWorkerRegister />
          <InstallPrompt />
          {children}
        </div>
      </body>
    </html>
  );
}
