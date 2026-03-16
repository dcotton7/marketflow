#!/usr/bin/env tsx
/**
 * Test if API returns A/D data
 */

async function testAPI() {
  try {
    const response = await fetch('http://localhost:5000/api/market-condition/themes');
    const data = await response.json();
    
    console.log('\n=== API Response Test ===\n');
    console.log(`Total themes: ${data.themes?.length || 0}`);
    
    if (data.themes && data.themes.length > 0) {
      console.log('\nFirst 5 themes A/D data:');
      for (let i = 0; i < Math.min(5, data.themes.length); i++) {
        const theme = data.themes[i];
        console.log(`  ${theme.id.padEnd(20)} accDistDays: ${theme.accDistDays !== undefined ? theme.accDistDays : 'UNDEFINED'}`);
      }
      
      // Check if accDistDays exists on any theme
      const hasAccDist = data.themes.some((t: any) => t.accDistDays !== undefined);
      console.log(`\nDoes API return accDistDays? ${hasAccDist ? 'YES' : 'NO'}`);
      
      // Count themes with non-zero A/D
      const nonZero = data.themes.filter((t: any) => t.accDistDays && t.accDistDays !== 0).length;
      console.log(`Themes with non-zero A/D: ${nonZero}/${data.themes.length}`);
    }
  } catch (error) {
    console.error('API test failed:', error);
  }
}

testAPI();
