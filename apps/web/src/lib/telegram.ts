import { configureAuth } from './api';

type LaunchParamsLike = {
  initDataRaw?: string;
  initData?: { startParam?: string };
};

export async function bootstrapTelegram() {
  const params = new URLSearchParams(window.location.search);
  const startFromUrl =
    params.get('tgWebAppStartParam') || params.get('startapp') || undefined;
  const devId =
    params.get('devUser') || localStorage.getItem('rf_dev_tg_id') || '1001';

  try {
    const sdk = await import('@telegram-apps/sdk');
    sdk.init();

    if (sdk.miniApp.mount.isAvailable()) sdk.miniApp.mount();
    if (sdk.themeParams.mount.isAvailable()) sdk.themeParams.mount();
    if (sdk.viewport.mount.isAvailable()) {
      await sdk.viewport.mount();
      if (sdk.viewport.expand.isAvailable()) sdk.viewport.expand();
    }
    if (sdk.miniApp.ready.isAvailable()) sdk.miniApp.ready();

    const lp = sdk.retrieveLaunchParams() as LaunchParamsLike;
    if (lp.initDataRaw) {
      configureAuth({
        mode: 'tma',
        raw: lp.initDataRaw,
        startParam: lp.initData?.startParam || startFromUrl,
      });
      return;
    }
  } catch {
    // Browser / non-Telegram environment
  }

  configureAuth({
    mode: 'dev',
    telegramId: devId,
    startParam: startFromUrl,
  });
}

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export async function hapticImpact(style: ImpactStyle = 'light') {
  try {
    const sdk = await import('@telegram-apps/sdk');
    if (sdk.hapticFeedback.impactOccurred.isAvailable()) {
      sdk.hapticFeedback.impactOccurred(style);
    }
  } catch {
    /* not in Telegram */
  }
}

export async function hapticNotify(type: 'success' | 'warning' | 'error') {
  try {
    const sdk = await import('@telegram-apps/sdk');
    if (sdk.hapticFeedback.notificationOccurred.isAvailable()) {
      sdk.hapticFeedback.notificationOccurred(type);
    }
  } catch {
    /* not in Telegram */
  }
}
