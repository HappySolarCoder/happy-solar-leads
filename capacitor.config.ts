import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.happyslr.raydar',
  appName: 'Raydar',
  webDir: 'out',
  loggingBehavior: 'debug',
  // Ship the compiled screens in the app. Never load a hosted site with server.url.
  server: { androidScheme: 'https' },
  ios: { contentInset: 'never', zoomEnabled: true, backgroundColor: '#FFFFFF' },
  android: { backgroundColor: '#FFFFFF', allowMixedContent: false },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'LIGHT' },
    SplashScreen: { launchShowDuration: 1500, backgroundColor: '#FFFFFF', showSpinner: false },
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
  },
};

export default config;
