import DashboardPage from './DashboardPage.jsx';

// Crypto page — same dashboard, calibrated for 24/7 crypto markets.
// Backend handles signal calibration (wider stops/TPs, BTC trend gate,
// Fear & Greed reviewer checks). This component just renders the
// dashboard with market='crypto' so DashboardPage swaps in CryptoContextBar
// and crypto-friendly labels.
export default function CryptoPage() {
  return <DashboardPage market="crypto" title="₿ CRYPTO SCANNER" />;
}
