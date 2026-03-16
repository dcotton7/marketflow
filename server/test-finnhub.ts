import 'dotenv/config';
import * as finnhub from './finnhub';

// Top 5 S&P 500 tickers (by market cap)
const sp500Tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];

// Top 5 Russell 2000 tickers (sample)
const russellTickers = ['TWNK', 'FIZZ', 'SMCI', 'TGTX', 'ALKS'];

async function testFinnhubData() {
  console.log('='.repeat(80));
  console.log('TESTING FINNHUB DATA FETCH');
  console.log('='.repeat(80));

  // Test S&P 500 tickers
  console.log('\n\n=== TOP 5 S&P 500 TICKERS ===\n');
  for (const symbol of sp500Tickers) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SYMBOL: ${symbol}`);
    console.log('='.repeat(80));

    try {
      const comprehensive = await finnhub.getComprehensiveFundamentals(symbol);

      console.log('\n--- PROFILE ---');
      console.log(JSON.stringify(comprehensive.profile, null, 2));

      console.log('\n--- METRICS ---');
      console.log(JSON.stringify(comprehensive.metrics, null, 2));

      console.log('\n--- RECOMMENDATIONS ---');
      console.log(JSON.stringify(comprehensive.recommendations, null, 2));

      console.log('\n--- PRICE TARGET ---');
      console.log(JSON.stringify(comprehensive.priceTarget, null, 2));

      console.log('\n--- EARNINGS SURPRISES ---');
      console.log(JSON.stringify(comprehensive.earningsSurprises, null, 2));

      if (comprehensive.profile) {
        console.log(`\nMARKET CAP: ${comprehensive.profile.marketCapitalization} (millions)`);
        console.log(`MARKET CAP CALCULATED: $${((comprehensive.profile.marketCapitalization || 0) * 1000000 / 1e9).toFixed(1)}B`);
      }
      if (comprehensive.metrics?.metric) {
        console.log(`METRICS MARKET CAP: ${comprehensive.metrics.metric.marketCapitalization} (millions)`);
      }
    } catch (error) {
      console.error(`ERROR fetching ${symbol}:`, error);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Test Russell tickers
  console.log('\n\n=== TOP 5 RUSSELL 2000 TICKERS ===\n');
  for (const symbol of russellTickers) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SYMBOL: ${symbol}`);
    console.log('='.repeat(80));

    try {
      const comprehensive = await finnhub.getComprehensiveFundamentals(symbol);

      console.log('\n--- PROFILE ---');
      console.log(JSON.stringify(comprehensive.profile, null, 2));

      console.log('\n--- METRICS ---');
      console.log(JSON.stringify(comprehensive.metrics, null, 2));

      console.log('\n--- RECOMMENDATIONS ---');
      console.log(JSON.stringify(comprehensive.recommendations, null, 2));

      console.log('\n--- PRICE TARGET ---');
      console.log(JSON.stringify(comprehensive.priceTarget, null, 2));

      console.log('\n--- EARNINGS SURPRISES ---');
      console.log(JSON.stringify(comprehensive.earningsSurprises, null, 2));

      if (comprehensive.profile) {
        console.log(`\nMARKET CAP: ${comprehensive.profile.marketCapitalization} (millions)`);
        console.log(`MARKET CAP CALCULATED: $${((comprehensive.profile.marketCapitalization || 0) * 1000000 / 1e9).toFixed(1)}B`);
      }
      if (comprehensive.metrics?.metric) {
        console.log(`METRICS MARKET CAP: ${comprehensive.metrics.metric.marketCapitalization} (millions)`);
      }
    } catch (error) {
      console.error(`ERROR fetching ${symbol}:`, error);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

testFinnhubData().catch(console.error);
