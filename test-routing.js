const { handlers } = require('@orad86/ai-aero-tools');

async function testRouting() {
  console.log('Testing routing tool: DAFNA to LGRP\n');
  
  try {
    const result = await handlers.analyze_route({
      points: ['DAFNA', 'LGRP'],
      units: 'nm',
      includeMagneticVariation: true,
      useAirways: true,
      verbose: true
    });
    
    console.log('✅ Success!');
    console.log('\nResult:', JSON.stringify(result, null, 2));
    
    if (result.success && result.data) {
      console.log('\n🛩️ Route Summary:');
      console.log(`Total Distance: ${result.data.totalDistance} nm`);
      console.log(`Points: ${result.data.summary.pointCount}`);
      console.log(`Segments: ${result.data.summary.segmentCount}`);
      
      if (result.data.waypoints) {
        console.log('\n📍 Waypoints:');
        result.data.waypoints.forEach((wp, i) => {
          console.log(`${i + 1}. ${wp.identifier} (${wp.type})`);
          if (wp.distanceFromPrevious) {
            console.log(`   Distance: ${wp.distanceFromPrevious} nm`);
          }
          if (wp.bearingFromPrevious) {
            console.log(`   Bearing: ${wp.bearingFromPrevious}°`);
          }
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
  }
}

testRouting();
