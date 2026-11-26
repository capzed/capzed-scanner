# TradeDesk — Levels & Setup Assistant

A free, browser-only prototype for crypto trading-level research and standardized setup exports.

## Current MVP
- Paste a list of Binance USDT-M Futures symbols and price levels.
- Fetch public Binance Futures candles (1m, 5m, 15m, 1h, 4h) directly from the browser.
- Rank supplied levels using a transparent confluence score across 1m, 5m, 15m, 1h, 4h, 1d and 1w candles.
- Rule-based pattern proxies for FVG, order blocks, liquidity sweeps, Wyckoff spring/upthrust, swing liquidity and Fibonacci confluence.
- Show a separate 30-minute volatility-envelope reach score and a retrospective historical touch-rate sample when enough comparable observations exist.
- Run local browser OCR on a supplied screenshot to suggest the symbol, direction when printed, TP1–TP5 and SL; the user enters the exact Entry price manually for each screenshot. Verify every suggestion before generating the English setup text.
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
- The scanner ranks only levels supplied by the user; it does not discover arbitrary chart levels.
- The 30-minute historical touch sample is based on a short recent 1m window and may be unavailable or statistically weak.
- Scores are heuristic research scores, not calibrated probabilities or guaranteed trade outcomes.
- The 30-minute score estimates proximity relative to recent volatility. It is not a statistical probability of activation.
- Screenshot OCR uses the free Tesseract.js library loaded from jsDelivr on demand. The screenshot is processed in the browser and is not uploaded by this app. The current parser uses OCR word coordinates to look for a numeric value to the right of a TP1–TP5 or SL label on approximately the same row. It can also suggest a symbol and timeframe when clearly recognized. It does not currently infer trade direction, detect unlabelled levels, or understand chart structure. It may misread decimals, labels, or axis values; verify every suggestion manually. Entry and direction remain user-controlled. First use requires internet access to load the OCR library and English language data.
- The current chart export is reconstructed from Binance candle data using the user's manually confirmed prices; it is not a direct edit of the uploaded screenshot.
- No orders are placed and no trade is published automatically.
- Binance public market-data endpoints may be unavailable or rate-limited in some networks/regions.

## Cost policy
This version makes no paid API calls and requires no secrets. Market data is requested from Binance's public endpoints. Static hosting can be provided through a free tier, subject to each provider's current limits. No paid service should be enabled without the owner's explicit approval.

## Privacy
Uploaded screenshots and generated exports are processed in the browser. Scan history is stored in localStorage on the current device. Do not use a shared device if you want to keep local history private.
