import puppeteer, { type Browser } from 'puppeteer'

/**
 * One headless Chromium per process, shared by extraction and rendering.
 * CHROME_PATH points at a system Chrome/Chromium; otherwise Puppeteer's managed build is used.
 */
let shared: Promise<Browser> | null = null

export function getBrowser(): Promise<Browser> {
  if (!shared) {
    shared = puppeteer
      .launch({
        headless: true,
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--hide-scrollbars',
          '--mute-audio',
          '--font-render-hinting=none',
          '--force-color-profile=srgb',
          ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : []),
        ],
      })
      .then((b) => {
        b.on('disconnected', () => {
          shared = null
        })
        return b
      })
      .catch((err) => {
        shared = null
        throw err
      })
  }
  return shared
}

export async function closeBrowser(): Promise<void> {
  const b = shared
  shared = null
  if (b) await (await b).close().catch(() => {})
}
