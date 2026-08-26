import { configureAuth } from './api';

type LaunchParamsLike = {
  initDataRaw?: string;
  /** Top-level start param from tgWebAppStartParam — often set when initData.startParam is empty. */
  startParam?: string;
  initData?: { startParam?: string };
};

const START_PARAM_STORAGE_KEY = 'rf_start_param';

function readStartParamFromLocation(): string | undefined {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return (
    query.get('tgWebAppStartParam') ||
    query.get('startapp') ||
    query.get('start_param') ||
    query.get('start') ||
    hash.get('tgWebAppStartParam') ||
    hash.get('startapp') ||
    hash.get('start_param') ||
    undefined
  );
}

function resolveStartParam(lp?: LaunchParamsLike): string | undefined {
  const fromLaunch =
    lp?.startParam ||
    lp?.initData?.startParam ||
    readStartParamFromLocation() ||
    undefined;

  if (fromLaunch) {
    try {
      sessionStorage.setItem(START_PARAM_STORAGE_KEY, fromLaunch);
    } catch {
      /* private mode */
    }
    return fromLaunch;
  }

  try {
    return sessionStorage.getItem(START_PARAM_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export async function bootstrapTelegram() {
  const params = new URLSearchParams(window.location.search);
  const startFromUrl = resolveStartParam();
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
        startParam: resolveStartParam(lp),
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
