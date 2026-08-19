import { useState, useEffect, useCallback, useRef } from 'react';
import TickerTape from '../components/TickerTape.jsx';
import MacroAlertBar from '../components/MacroAlertBar.jsx';
import MarketStatus from '../components/MarketStatus.jsx';
import TradeSection from '../components/TradeSection.jsx';
import EconomicCalendar from '../components/EconomicCalendar.jsx';
import TonightsCatalyst from '../components/TonightsCatalyst.jsx';
import SummaryStrip from '../components/SummaryStrip.jsx';
import PositionTracker, { loadPositions } from '../components/PositionTracker.jsx';
import LoadingState from '../components/LoadingState.jsx';
import RiskControls from '../components/RiskControls.jsx';
import PreMarketMovers from '../components/PreMarketMovers.jsx';
import TradeJournal, { logTradeClose } from '../components/TradeJournal.jsx';
import { evaluateRiskGuard, getTodaysPnL, loadGuardSettings } from '../utils/riskGuard.js';
import LearningInsights from '../components/LearningInsights.jsx';
import ForexSessionBar from '../components/ForexSessionBar.jsx';
import CurrencyStrengthMeter from '../components/CurrencyStrengthMeter.jsx';
import CommodityScheduleBar from '../components/CommodityScheduleBar.jsx';
import CryptoContextBar from '../components/CryptoContextBar.jsx';
import InventoryReleaseBar from '../components/InventoryReleaseBar.jsx';

// Default ticker tape (stocks)
const DEFAULT_TAPE = ['AAPL','MSFT','NVDA','TSLA','META','GOOGL','AMZN','AMD','SPY','QQQ','GLD','BTC-USD','ETH-USD','CL=F','JPM','COIN','PLTR','MSTR','IWM','SMCI'];
const FOREX_TAPE      = ['EURUSD=X','GBPUSD=X','USDJPY=X','USDCHF=X','AUDUSD=X','NZDUSD=X','USDCAD=X','EURGBP=X','EURJPY=X','GBPJPY=X','USDCNY=X','USDMXN=X','BTC-USD','ETH-USD','SOL-USD','XRP-USD','DX-Y.NYB','^TNX'];
const COMMODITIES_TAPE = ['GC=F','SI=F','CL=F','BZ=F','NG=F','HG=F','PL=F','PA=F','ZC=F','ZS=F','ZW=F','KC=F','SB=F','GLD','SLV','USO','UNG','DBA','GDX'];
const CRYPTO_TAPE = ['BTC-USD','ETH-USD','SOL-USD','BNB-USD','XRP-USD','ADA-USD','AVAX-USD','DOGE-USD','LINK-USD','MATIC-USD','DOT-USD','ARB-USD','OP-USD','LTC-USD','BCH-USD','SHIB-USD','NEAR-USD','APT-USD','TRX-USD','ATOM-USD'];

// Refresh intervals — 10-second polling during ANY live session
const INTERVAL_LIVE        = 10_000;   // 10s prices during market open / pre / post
const INTERVAL_DARK        = 300_000;  // 5min when fully closed (overnight / weekend)
const INTERVAL_SCAN_OPEN   = 60_000;   // 60s full scan when market open
const INTERVAL_SCAN_CLOSED = 600_000;  // 10min scan when closed

// Pick the best available "live" price for a ticker:
// pre-market price > post-market price > regular price
function getEffectivePrice(live) {
  if (!live || live.error) return null;
  if (live.preMarketPrice && live.preMarketPrice > 0)  return { price: live.preMarketPrice,  session: 'pre' };
  if (live.postMarketPrice && live.postMarketPrice > 0) return { price: live.postMarketPrice, session: 'post' };
  if (live.price && live.price > 0)                     return { price: live.price,           session: 'reg' };
  return null;
}

function computeLiveEntryStatus(trade, livePrice) {
  if (livePrice == null) return null;
  const { entryLow, entryHigh, direction } = trade;
  if (entryLow == null || entryHigh == null) return null;

  if (direction === 'LONG') {
    if (livePrice > entryHigh * 1.015) {
      return { status: 'MISSED', text: `Price drifted ${((livePrice - entryHigh) / entryHigh * 100).toFixed(1)}% above zone — wait for pullback` };
    }
    if (livePrice > entryHigh) {
      return { status: 'ABOVE_ZONE', text: 'Just above zone — wait for small dip' };
    }
    if (livePrice < entryLow * 0.985) {
      return { status: 'BELOW_ZONE', text: `Price ${((entryLow - livePrice) / entryLow * 100).toFixed(1)}% below zone — even better entry available` };
    }
    return { status: 'IN_ZONE', text: 'Price is in the entry zone — ready to enter' };
  } else {
    if (livePrice < entryLow * 0.985) {
      return { status: 'MISSED', text: `Price drifted ${((entryLow - livePrice) / entryLow * 100).toFixed(1)}% below zone — wait for bounce` };
    }
    if (livePrice < entryLow) {
      return { status: 'BELOW_ZONE', text: 'Just below zone — wait for small bounce' };
    }
    if (livePrice > entryHigh * 1.015) {
      return { status: 'ABOVE_ZONE', text: `Price ${((livePrice - entryHigh) / entryHigh * 100).toFixed(1)}% above zone — even better short entry available` };
    }
    return { status: 'IN_ZONE', text: 'Price is in the entry zone — ready to enter' };
  }
}

// Trade is no longer valid if price has already reached TP or SL — premise broken
function isTradeInvalid(trade, livePrice) {
  if (livePrice == null) return false;
  if (trade.direction === 'LONG') {
    // Already hit TP — opportunity is over
    if (livePrice >= trade.tp) return { reason: 'TP_HIT', text: 'TP already reached' };
    // Already broke SL — premise invalidated
    if (livePrice <= trade.sl) return { reason: 'SL_HIT', text: 'SL already broken — premise invalid' };
  } else {
    if (livePrice <= trade.tp) return { reason: 'TP_HIT', text: 'TP already reached' };
    if (livePrice >= trade.sl) return { reason: 'SL_HIT', text: 'SL already broken — premise invalid' };
  }
  return false;
}

// Enrich each trade with live price + extended-hours price + dynamic entry status.
// Drops trades that are no longer valid (TP hit / SL hit / drifted past zone).
function enrichTrades(trades, livePrices, hasLiveData) {
  return trades
    .map(trade => {
      const live = livePrices[trade.ticker];
      const eff  = getEffectivePrice(live);
      if (!eff) return trade;

      const newStatus  = computeLiveEntryStatus(trade, eff.price);
      const invalidity = isTradeInvalid(trade, eff.price);

      return {
        ...trade,
        price: eff.price,
        priceSession: eff.session,   // 'pre' | 'post' | 'reg'
        regularPrice: live.price,
        preMarketPrice: live.preMarketPrice,
        postMarketPrice: live.postMarketPrice,
        changePercent: live.changePercent ?? trade.changePercent,
        ...(newStatus ? { entryStatus: newStatus.status, entryStatusText: newStatus.text } : {}),
        invalidity: invalidity || null,
        timestamp: live.timestamp || trade.timestamp
      };
    })
    // Drop trades that are no longer in play during any live session
    .filter(trade => {
      if (!hasLiveData) return true;          // Don't filter when no live data
      if (trade.invalidity) return false;     // TP/SL already hit
      if (trade.entryStatus === 'MISSED') return false;
      return true;
    });
}

export default function DashboardPage({ market = 'stocks', title = null }) {
  const TICKER_TAPE = market === 'forex' ? FOREX_TAPE
                    : market === 'commodities' ? COMMODITIES_TAPE
                    : market === 'crypto' ? CRYPTO_TAPE
                    : DEFAULT_TAPE;
  const PAGE_TITLE = title || (
    market === 'forex' ? '💱 FOREX SCANNER' :
    market === 'commodities' ? '🛢 COMMODITIES SCANNER' :
    market === 'crypto' ? '₿ CRYPTO SCANNER' :
    null
  );
  const isCrypto = market === 'crypto';
  const [marketStatus, setMarketStatus]   = useState(null);
  const [trades, setTrades]               = useState({ enterNow: [], waitForBounce: [], carryForward: [] });
  const [tickerPrices, setTickerPrices]   = useState({});
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [catalysts, setCatalysts]         = useState([]);
  const [macroContext, setMacroContext]    = useState([]);
  const [positions, setPositions]         = useState(() => loadPositions());
  const [scanStats, setScanStats]         = useState({});
  const [loading, setLoading]             = useState(true);
  const [scanning, setScanning]           = useState(false);
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [error, setError]                 = useState(null);
  const [newTickers, setNewTickers]       = useState(new Set()); // freshly-appearing setups
  const [accountSize, setAccountSize]     = useState(10000);
  const [riskPct, setRiskPct]             = useState(1);
  const [soundEnabled, setSoundEnabled]   = useState(true);
  const [secondsToNextScan, setSecondsToNextScan] = useState(null);
  const [extendedMovers, setExtendedMovers] = useState(null);
  const [journalRefreshKey, setJournalRefreshKey] = useState(0);
  const [forexContext, setForexContext]     = useState(null);    // sessions, strength, DXY
  const [commodContext, setCommodContext]   = useState(null);    // schedule, DXY, drivers

  const marketStatusRef = useRef(null);
  const prevTickersRef  = useRef(new Set());
  const prevPassPickRef = useRef(new Set()); // For HIGH-PROB PASS alerts
  const lastScanTimeRef = useRef(Date.now());

  // Play alert beep using Web Audio API (no asset required)
  const playAlertBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.18);
      });
    } catch {}
  }, [soundEnabled]);

  // "Take this trade" handler — adds to position tracker (with risk guard check)
  const handleTakeTrade = useCallback((setup) => {
    // Build sector map from current trades so guard can detect concentration
    const allTrades = [...(trades.enterNow || []), ...(trades.waitForBounce || []), ...(trades.carryForward || [])];
    const sectorMap = {};
    allTrades.forEach(t => { if (t.ticker && t.sector) sectorMap[t.ticker] = t.sector; });
    const candidateSector = allTrades.find(t => t.ticker === setup.ticker)?.sector;

    const guard = evaluateRiskGuard(positions, accountSize, setup.ticker, candidateSector, sectorMap);

    if (guard.blocked) {
      alert('⛔ Trade blocked by risk guard:\n\n' + guard.issues.filter(i => i.severity === 'block').map(i => '• ' + i.text).join('\n'));
      return;
    }
    if (guard.issues.some(i => i.severity === 'warn')) {
      const warnings = guard.issues.filter(i => i.severity === 'warn').map(i => '• ' + i.text).join('\n');
      if (!confirm('⚠ Risk warning:\n\n' + warnings + '\n\nProceed anyway?')) return;
    }

    setPositions(prev => [
      { id: Date.now(), ...setup, enteredAt: Date.now() },
      ...prev
    ]);
    setTimeout(() => {
      document.querySelector('[data-section="position-tracker"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, [positions, accountSize, trades]);

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchMarketStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/market-status');
      const d = await r.json();
      setMarketStatus(d);
      marketStatusRef.current = d;
    } catch { /* silently fail */ }
  }, []);

  const fetchTickerPrices = useCallback(async (extraTickers = []) => {
    try {
      const tickers = [...new Set([...TICKER_TAPE, ...extraTickers])].join(',');
      // extraTickers are the live trades and open positions — the prices that
      // must be real-time. Flagging them as priority keeps the limited
      // real-time quota on those rather than on the decorative ticker tape.
      const priority = [...new Set(extraTickers)].join(',');
      const url = `/api/quotes/batch?tickers=${tickers}` + (priority ? `&priority=${priority}` : '');
      const r = await fetch(url);
      const d = await r.json();
      setTickerPrices(d);
    } catch { /* silently fail */ }
  }, [TICKER_TAPE]);

  const fetchScan = useCallback(async () => {
    try {
      setScanning(true);
      const r = await fetch(`/api/scanner/scan?market=${market}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const nextTrades = d.trades || { enterNow: [], waitForBounce: [], carryForward: [] };

      // Detect newly-appearing tickers vs previous scan
      const currentTickers = new Set([
        ...(nextTrades.enterNow || []).map(t => t.ticker),
        ...(nextTrades.waitForBounce || []).map(t => t.ticker),
        ...(nextTrades.carryForward || []).map(t => t.ticker)
      ]);
      const prev = prevTickersRef.current;
      const fresh = [...currentTickers].filter(t => !prev.has(t));
      if (prev.size > 0 && fresh.length > 0) {
        setNewTickers(new Set(fresh));
        // Clear NEW badge after 30s
        setTimeout(() => setNewTickers(new Set()), 30_000);
      }
      prevTickersRef.current = currentTickers;

      // Audio alert: only fire when a NEW high-prob PASS appears
      const currentHighPassTickers = new Set(
        [...(nextTrades.enterNow || []), ...(nextTrades.waitForBounce || []), ...(nextTrades.carryForward || [])]
          .filter(t => t.probability === 'HIGH' && t.review?.verdict === 'PASS')
          .map(t => t.ticker)
      );
      const prevHigh = prevPassPickRef.current;
      const newHighPasses = [...currentHighPassTickers].filter(t => !prevHigh.has(t));
      if (prevHigh.size > 0 && newHighPasses.length > 0) {
        playAlertBeep();
        // Browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('🎯 New A+ Trade Setup', {
            body: `${newHighPasses.join(', ')} — HIGH probability, reviewer PASS`,
            silent: false
          });
        }
      }
      prevPassPickRef.current = currentHighPassTickers;

      setTrades(nextTrades);
      setScanStats({
        scannedCount: d.scannedCount,
        passedFilter: d.passedFilter,
        vix: d.vix,
        vixRegime: d.vixRegime,
        marketRegime: d.marketRegime,
        choppiness: d.choppiness,
        enterNowEmptyReason: d.enterNowEmptyReason,
        btcTrend: d.btcTrend,
        cryptoContext: d.cryptoContext,
        inventoryReleases: d.inventoryReleases,
        entryTiming: d.entryTiming   // crypto: getCryptoEntryTiming(); else: US getEntryTiming()
      });
      setLastUpdated(new Date());
      lastScanTimeRef.current = Date.now();
      setError(null);

      // Trigger an immediate price refresh for the new trade tickers
      const tradeTickers = [...currentTickers];
      if (tradeTickers.length) fetchTickerPrices(tradeTickers);
    } catch (err) {
      setError('Backend connection failed — start the backend server on port 3001');
    } finally {
      setScanning(false);
    }
  }, [market, fetchTickerPrices, playAlertBeep]);

  const fetchCalendar = useCallback(async () => {
    try {
      const r = await fetch('/api/calendar/events');
      const d = await r.json();
      setCalendarEvents(d.events || []);
      setCatalysts(d.catalysts || []);
      setMacroContext(d.macro || []);
    } catch { /* silently fail */ }
  }, []);

  const fetchForexContext = useCallback(async () => {
    try {
      const r = await fetch('/api/forex/context');
      const d = await r.json();
      setForexContext(d);
    } catch { /* silent */ }
  }, []);

  const fetchCommodContext = useCallback(async () => {
    try {
      const r = await fetch('/api/commodities/context');
      const d = await r.json();
      setCommodContext(d);
    } catch { /* silent */ }
  }, []);

  const fetchExtendedMovers = useCallback(async () => {
    try {
      const r = await fetch('/api/scanner/extended-movers');
      const d = await r.json();
      setExtendedMovers(d);
    } catch { /* silently fail */ }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    // [FAST-SYSTEM-101] Progressive render: show page as soon as scan finishes.
    // Other init fetches (tape, calendar, extended-movers) continue in background.
    // Lazy-load extended-movers — only when in PRE_MARKET / AFTER_HOURS session.
    const init = async () => {
      setLoading(true);
      await fetchMarketStatus();
      const scanPromise = fetchScan();              // critical path
      fetchTickerPrices();                          // non-blocking
      fetchCalendar();                              // non-blocking
      if (market === 'forex') fetchForexContext();
      if (market === 'commodities') fetchCommodContext();
      const sess = marketStatusRef.current?.session;
      if (sess === 'PRE_MARKET' || sess === 'AFTER_HOURS') {
        fetchExtendedMovers();                      // only when relevant
      }
      await scanPromise;
      setLoading(false);
    };
    init();
  }, []);

  // ── Refresh prices: 10s during ANY live session (open, pre, post) ──────

  useEffect(() => {
    const session = marketStatus?.session;
    const isLive = isCrypto || session === 'MARKET_OPEN' || session === 'PRE_MARKET' || session === 'AFTER_HOURS';
    const interval = isLive ? INTERVAL_LIVE : INTERVAL_DARK;
    const tick = () => {
      fetchMarketStatus();
      const tradeTickers = [
        ...(trades.enterNow || []),
        ...(trades.waitForBounce || []),
        ...(trades.carryForward || [])
      ].map(t => t.ticker);
      const posTickers = positions.map(p => p.ticker);
      fetchTickerPrices([...tradeTickers, ...posTickers]);
    };
    const timer = setInterval(tick, interval);
    return () => clearInterval(timer);
  }, [marketStatus?.session, positions, trades, fetchMarketStatus, fetchTickerPrices]);

  // ── Refresh extended movers on scan cadence ─────────────────────────────

  useEffect(() => {
    const session = marketStatus?.session;
    if (session !== 'PRE_MARKET' && session !== 'AFTER_HOURS') return;
    const timer = setInterval(fetchExtendedMovers, 60_000);
    return () => clearInterval(timer);
  }, [marketStatus?.session, fetchExtendedMovers]);

  // ── Refresh forex / commodities context every 60s ───────────────────────
  useEffect(() => {
    if (market === 'forex') {
      const t = setInterval(fetchForexContext, 60_000);
      return () => clearInterval(t);
    }
    if (market === 'commodities') {
      const t = setInterval(fetchCommodContext, 300_000); // 5min — schedule changes slowly
      return () => clearInterval(t);
    }
  }, [market, fetchForexContext, fetchCommodContext]);

  // ── Countdown to next scan (1-second tick) ───────────────────────────────

  useEffect(() => {
    const scanInterval = (isCrypto || marketStatus?.isOpen) ? INTERVAL_SCAN_OPEN : INTERVAL_SCAN_CLOSED;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.round((lastScanTimeRef.current + scanInterval - Date.now()) / 1000));
      setSecondsToNextScan(remaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [marketStatus?.isOpen, isCrypto]);

  // ── Refresh scan: 60s when live, 10min when closed (crypto is always live) ─

  useEffect(() => {
    const interval = (isCrypto || marketStatus?.isOpen) ? INTERVAL_SCAN_OPEN : INTERVAL_SCAN_CLOSED;
    const timer = setInterval(fetchScan, interval);
    return () => clearInterval(timer);
  }, [marketStatus?.isOpen, fetchScan, isCrypto]);

  // ── Refresh prices when positions change (get live data immediately) ───────

  useEffect(() => {
    if (positions.length > 0) {
      fetchTickerPrices(positions.map(p => p.ticker));
    }
  }, [positions.length]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const handleManualRefresh = () => {
    fetchMarketStatus();
    fetchTickerPrices(positions.map(p => p.ticker));
    fetchScan();
    fetchCalendar();
  };

  return (
    <div className="pb-14">

      {/* ── Page title (for Forex / Commodities) ───────────────────────── */}
      {PAGE_TITLE && (
        <div className="px-4 pt-3">
          <h1 className="text-2xl font-condensed font-bold tracking-widest text-cyan-400">{PAGE_TITLE}</h1>
          <p className="text-[11px] text-[#444] font-mono">
            {market === 'forex' && 'Market-specific: 24/5 hours · Sessions · Currency strength · Pip-based stops'}
            {market === 'commodities' && 'Market-specific: Inventory reports · DXY correlation · Seasonal patterns'}
            {market === 'crypto' && 'Market-specific: 24/7 trading · BTC trend filter · Fear & Greed · Session liquidity · Wider stops for vol'}
          </p>
        </div>
      )}

      {/* ── Forex-specific top sections ──────────────────────────────────── */}
      {market === 'forex' && forexContext && (
        <>
          <ForexSessionBar session={forexContext.session} />
          <CurrencyStrengthMeter strength={forexContext.currencyStrength} dxy={forexContext.dxy} />
        </>
      )}

      {/* ── Commodities-specific top sections ────────────────────────────── */}
      {market === 'commodities' && commodContext && (
        <CommodityScheduleBar schedule={commodContext.schedule} dxy={commodContext.dxy} />
      )}
      {market === 'commodities' && scanStats.inventoryReleases && (
        <InventoryReleaseBar releases={scanStats.inventoryReleases} />
      )}

      {/* ── Crypto-specific context bar ──────────────────────────────────── */}
      {isCrypto && (
        <CryptoContextBar context={scanStats.cryptoContext} btcTrend={scanStats.btcTrend} />
      )}

      {/* ── Sub-header bar with controls ───────────────────────────────── */}
      <header className="sticky top-[52px] z-40 bg-[#080808]/95 backdrop-blur border-b border-[#151515]">
        <div className="flex items-center sm:justify-end px-3 sm:px-4 py-2 gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <MarketStatus status={marketStatus} lastUpdated={lastUpdated} scanning={scanning} />
            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next && 'Notification' in window && Notification.permission === 'default') {
                  Notification.requestPermission();
                }
              }}
              title={soundEnabled ? 'Alerts ON' : 'Alerts OFF'}
              className={`text-[10px] font-mono px-3 py-1.5 border rounded transition-colors ${
                soundEnabled
                  ? 'border-green-500/40 text-green-400 hover:border-green-500/60'
                  : 'border-[#2a2a2a] text-[#444] hover:border-[#444]'
              }`}
            >
              {soundEnabled ? '🔔 Alerts ON' : '🔕 Alerts OFF'}
            </button>
            <RiskControls
              accountSize={accountSize}
              setAccountSize={setAccountSize}
              riskPct={riskPct}
              setRiskPct={setRiskPct}
            />
            <button
              onClick={handleManualRefresh}
              disabled={scanning}
              className="text-[10px] font-mono px-3 py-1.5 border border-[#2a2a2a] hover:border-green-500/40 text-[#444] hover:text-green-400 rounded transition-colors disabled:opacity-40"
            >
              ⟳ Refresh
            </button>
          </div>
        </div>

        {/* Ticker tape */}
        <TickerTape prices={tickerPrices} />
      </header>

      {/* ── Macro alert bar ────────────────────────────────────────────── */}
      <MacroAlertBar context={macroContext} />

      {/* ── Market regime + VIX status banner (stock/forex/commodity only) ─ */}
      {!isCrypto && scanStats.vix != null && (
        <div className={`mx-4 mt-3 p-3 rounded text-[11px] font-mono border flex items-center justify-between gap-3 flex-wrap ${
          scanStats.vixRegime === 'EXTREME'  ? 'bg-red-500/10 border-red-500/40 text-red-300' :
          scanStats.vixRegime === 'ELEVATED' ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' :
                                                'bg-green-500/10 border-green-500/30 text-green-300'
        }`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-bold">
              {scanStats.vixRegime === 'EXTREME'  && '🚨 EXTREME VOLATILITY'}
              {scanStats.vixRegime === 'ELEVATED' && '⚠ ELEVATED VOLATILITY'}
              {scanStats.vixRegime === 'NORMAL'   && '✓ NORMAL MARKET CONDITIONS'}
              {scanStats.vixRegime === 'LOW'      && '✓ LOW VOLATILITY — TREND-FRIENDLY'}
            </span>
            <span className="opacity-70">VIX {scanStats.vix.toFixed(1)}</span>
            <span className="opacity-70">·</span>
            <span className="opacity-70">SPY: {scanStats.marketRegime}</span>
          </div>
          <span className="text-[10px] opacity-60">
            {scanStats.vixRegime === 'EXTREME'  && 'Signals filtered aggressively. Consider sitting out.'}
            {scanStats.vixRegime === 'ELEVATED' && 'Reduce size by 50%. Expect false breakouts.'}
            {scanStats.vixRegime === 'NORMAL'   && 'Standard risk management applies.'}
            {scanStats.vixRegime === 'LOW'      && 'Good environment for trend-following.'}
          </span>
        </div>
      )}

      {/* ── Daily P&L / Risk guard banner ──────────────────────────────── */}
      {(() => {
        const { pnl, count } = getTodaysPnL();
        const settings = loadGuardSettings();
        const limit = -accountSize * (settings.dailyLossLimitPct / 100);
        if (count === 0) return null;
        const pct = (pnl / accountSize) * 100;
        const breached = pnl <= limit;
        const warning  = pnl <= limit * 0.7;
        return (
          <div className={`mx-4 mt-2 p-2 rounded text-[11px] font-mono border flex items-center justify-between gap-3 ${
            breached ? 'bg-red-500/15 border-red-500/40 text-red-300 warn-pulse' :
            warning  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                       'bg-[#0a0a0a] border-[#1a1a1a] text-[#666]'
          }`}>
            <span>
              {breached && '🛑 '}
              Today's P&L: <strong className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(0)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</strong>
              {' · '}{count} trade{count !== 1 ? 's' : ''} closed today
            </span>
            {breached && <strong>DAILY LOSS LIMIT HIT — NEW TRADES BLOCKED</strong>}
            {warning && !breached && <strong>Approaching limit (${limit.toFixed(0)})</strong>}
          </div>
        );
      })()}

      {/* ── Market regime banner (choppy / trending) — SPY-driven, hide on crypto ── */}
      {!isCrypto && scanStats.choppiness?.regime && scanStats.choppiness.regime !== 'unknown' && (
        <div className={`mx-4 mt-2 p-3 rounded text-[11px] font-mono border flex items-center justify-between gap-3 flex-wrap ${
          scanStats.choppiness.regime === 'STRONG_TREND' ? 'bg-green-500/10 border-green-500/40 text-green-300' :
          scanStats.choppiness.regime === 'TRENDING'     ? 'bg-green-500/8  border-green-500/30 text-green-400' :
          scanStats.choppiness.regime === 'MIXED'        ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' :
          scanStats.choppiness.regime === 'CHOPPY'       ? 'bg-red-500/10   border-red-500/40   text-red-300' :
                                                            'bg-[#0a0a0a] border-[#1a1a1a] text-[#666]'
        }`}>
          <div>
            <span className="font-bold">📈 Market: {scanStats.choppiness.label}</span>
            <span className="opacity-80 ml-2">· {scanStats.choppiness.advice}</span>
          </div>
          <span className="text-[10px] opacity-70">
            Efficiency {(scanStats.choppiness.efficiency * 100).toFixed(0)}% · SPY 10d {scanStats.choppiness.netMovePct >= 0 ? '+' : ''}{scanStats.choppiness.netMovePct}%
          </span>
        </div>
      )}

      {/* ── Data transparency disclaimer ───────────────────────────────── */}
      <div className="mx-4 mt-2 p-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded text-[10px] text-[#444] font-mono leading-relaxed">
        <span className="text-[#666]">ℹ Data integrity:</span> Prices are sourced from Yahoo Finance — may be delayed up to 15 minutes for some tickers. <b className="text-amber-400/80">Always verify the live bid/ask on TradingView or your broker before entering.</b> This dashboard filters candidates — it does not guarantee any outcome. Combine with your own analysis.
      </div>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-400 font-mono">
          ⚠ {error}
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="max-w-[1600px] mx-auto px-2 sm:px-4 pt-3 sm:pt-5">
        {loading ? (
          <LoadingState />
        ) : (
          <>
            {/* Scan meta with live freshness countdown */}
            <div className="text-[10px] text-[#2a2a2a] font-mono mb-5 flex flex-wrap items-center gap-2">
              {scanStats.scannedCount > 0 && (
                <>
                  <span>Scanned {scanStats.scannedCount} tickers</span>
                  <span className="text-[#1a1a1a]">·</span>
                  <span className="text-green-500/40">{scanStats.passedFilter} passed filter</span>
                  <span className="text-[#1a1a1a]">·</span>
                </>
              )}
              {secondsToNextScan != null && secondsToNextScan > 0 && (
                <span className="text-cyan-500/50">⟳ Next scan in {secondsToNextScan}s</span>
              )}
              {secondsToNextScan === 0 && <span className="text-amber-400 animate-pulse">⟳ Scanning now…</span>}
              <span className="text-[#1a1a1a]">·</span>
              {(() => {
                const s = marketStatus?.session;
                const isLive = isCrypto || s === 'MARKET_OPEN' || s === 'PRE_MARKET' || s === 'AFTER_HOURS';
                const sessLabel = isCrypto ? '24/7 live' : s === 'MARKET_OPEN' ? 'open' : s === 'PRE_MARKET' ? 'pre-market' : s === 'AFTER_HOURS' ? 'after-hours' : 'closed';
                return (
                  <>
                    <span className="text-blue-500/40">Prices refresh every {isLive ? '10' : '300'}s ({sessLabel})</span>
                    <span className="text-[#1a1a1a]">·</span>
                    <span>{isLive ? 'Stale setups + TP/SL-hit auto-removed' : 'Setups based on last close'}</span>
                  </>
                );
              })()}
            </div>

            {(() => {
              const session = marketStatus?.session;
              const hasLiveData = isCrypto || session === 'MARKET_OPEN' || session === 'PRE_MARKET' || session === 'AFTER_HOURS';
              const liveEnter  = enrichTrades(trades.enterNow      || [], tickerPrices, hasLiveData);
              const liveBounce = enrichTrades(trades.waitForBounce || [], tickerPrices, hasLiveData);
              const liveCarry  = enrichTrades(trades.carryForward  || [], tickerPrices, hasLiveData);
              const commonProps = {
                newTickers, accountSize, riskPct,
                entryTiming: isCrypto                ? scanStats.entryTiming
                          : market === 'forex'       ? forexContext?.entryTiming
                                                      : marketStatus?.entryTiming,
                onTakeTrade: handleTakeTrade
              };
              return (
                <>
                  <TradeSection trades={liveEnter}  type="enter"  {...commonProps} emptyReason={scanStats.enterNowEmptyReason} />
                  <TradeSection trades={liveBounce} type="bounce" {...commonProps} />
                  <TradeSection trades={liveCarry}  type="carry"  {...commonProps} />
                </>
              );
            })()}

            {/* PRE-MARKET / AFTER-HOURS MOVERS — only shown in extended sessions */}
            {(marketStatus?.session === 'PRE_MARKET' || marketStatus?.session === 'AFTER_HOURS') && extendedMovers && (
              <PreMarketMovers data={extendedMovers} marketSession={marketStatus.session} />
            )}

            {/* POSITION TRACKER */}
            <PositionTracker
              positions={positions}
              setPositions={setPositions}
              livePrices={tickerPrices}
              onCloseTrade={(pos, exit) => {
                logTradeClose({ ...pos, exit });
                setJournalRefreshKey(k => k + 1);
              }}
            />

            {/* PERSONALIZED LEARNING INSIGHTS */}
            <LearningInsights refreshKey={journalRefreshKey} />

            {/* TRADE JOURNAL */}
            <TradeJournal refreshKey={journalRefreshKey} />
          </>
        )}
      </main>

      {/* ── Summary strip — sticky bottom ──────────────────────────────── */}
      <SummaryStrip trades={trades} scanStats={scanStats} tickerPrices={tickerPrices} />

    </div>
  );
}
