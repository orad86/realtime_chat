#!/usr/bin/env node

const https = require('https');
const http = require('http');

const url = 'https://realtime-chat-henna.vercel.app/api/learning/process';

console.log('🚀 Starting learning job...\n');

function makeRequest(url) {
  const protocol = url.startsWith('https') ? https : http;
  
  protocol.get(url, (res) => {
    // Handle redirects
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      const redirectUrl = res.headers.location.startsWith('http') 
        ? res.headers.location 
        : `https://realtime-chat-henna.vercel.app${res.headers.location}`;
      console.log(`🔄 Following redirect to: ${redirectUrl}`);
      return makeRequest(redirectUrl);
    }
    
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('✅ Learning job completed!\n');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.status === 'completed') {
        console.log(`\n📊 Summary:`);
        console.log(`   - Interactions processed: ${result.processed}`);
        console.log(`   - Strategies created: ${result.strategiesCreated}`);
        console.log(`   - Strategies rejected: ${result.strategiesRejected || 0}`);
        
        if (result.errors && result.errors.length > 0) {
          console.log(`\n⚠️  Errors:`);
          result.errors.forEach(err => console.log(`   - ${err}`));
        }
      } else if (result.status === 'no_work') {
        console.log('\n📭 No unprocessed interactions found');
      } else if (result.status === 'error') {
        console.log(`\n❌ Error: ${result.error}`);
      }
    } catch (e) {
      console.error('❌ Failed to parse response:', e);
      console.log('Raw response:', data);
    }
    });
  }).on('error', (err) => {
    console.error('❌ Request failed:', err.message);
    process.exit(1);
  });
}

// Start the request
makeRequest(url);
