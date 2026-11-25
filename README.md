# TradeDesk — Levels & Setup Assistant

A free, browser-only prototype for crypto trading-level research and standardized setup exports.

## Current MVP
- Paste a list of Binance USDT-M Futures symbols and price levels.
- Fetch public Binance Futures candles (1m, 5m, 15m, 1h, 4h) directly from the browser.
- Rank supplied levels using a transparent confluence score across 1m, 5m, 15m, 1h, 4h, 1d and 1w candles.\n- Rule-based pattern proxies for FVG, order blocks, liquidity sweeps, Wyckoff spring/upthrust, swing liquidity and Fibonacci confluence.\n- Show a separate 30-minute volatility-envelope reach score and a retrospective historical touch-rate sample when enough comparable observations exist.
- Upload a chart screenshot locally, confirm Entry / TP1–TP4 / SL, and generate the requested English setup text.
- Export a desktop-style PNG and plain-text setup.
- Store recent activity in browser localStorage only.
- Installable PWA shell; no backend, API key, paid model, database, or subscription.

## Run locally
Open `index.html` in a modern browser, or serve this folder with any static web server. For PWA installation and service-worker support, use HTTPS (for example GitHub Pages or Cloudflare Pages free static hosting) or localhost.

## Level input format
One level per line:

```text
BTCUSDT 95000
ETHUSDT 3400 SHORT
SOLUSDT, 180, LONG
```

If direction is omitted, the prototype infers LONG when the level is below current price and SHORT when it is above current price.

## Important limitations
- The scanner ranks only levels supplied by the user; it does not discover arbitrary chart levels.\n- The 30-minute historical touch sample is based on a short recent 1m window and may be unavailable or statistically weak.
- Scores are heuristic research scores, not calibrated probabilities or guaranteed trade outcomes.
- The 30-minute score estimates proximity relative to recent volatility. It is not a statistical probability of activation.
- Automatic screenshot OCR / visual interpretation is not enabled yet. The screenshot preview is kept in-browser; the current chart export is reconstructed from Binance candle data using the user's manually confirmed prices. It does not claim to have read the screenshot.
- No orders are placed and no trade is published automatically.
- Binance public market-data endpoints may be unavailable or rate-limited in some networks/regions.

## Cost policy
This version makes no paid API calls and requires no secrets. Market data is requested from Binance's public endpoints. Static hosting can be provided through a free tier, subject to each provider's current limits. No paid service should be enabled without the owner's explicit approval.

## Privacy
Uploaded screenshots and generated exports are processed in the browser. Scan history is stored in localStorage on the current device. Do not use a shared device if you want to keep local history private.
