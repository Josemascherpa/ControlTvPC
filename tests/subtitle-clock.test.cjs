const {test}=require('node:test');const assert=require('node:assert/strict');
test('sincronización: atrasar, adelantar, ritmo y frases superpuestas',async()=>{
 const {indexCues,activeCuesAt,subtitleTime}=await import('../ui/js/web/cine/subtitle-clock.js');
 const first={startTime:10,endTime:12,text:'uno'},second={startTime:11,endTime:13,text:'dos'};
 const index=indexCues([second,first]);
 assert.deepEqual(activeCuesAt(index,subtitleTime(10,1)),[],'Atrasar no adelanta');
 assert.deepEqual(activeCuesAt(index,subtitleTime(11,1)),[first]);
 assert.deepEqual(activeCuesAt(index,subtitleTime(9,-1)),[first]);
 assert.deepEqual(activeCuesAt(index,11.5),[first,second]);
 assert.deepEqual(activeCuesAt(index,12),[second],'Fin exclusivo');
 assert.equal(subtitleTime(2400,0,24/25),2500,'Corregir desfase progresivo');
 assert.deepEqual(activeCuesAt(index,100),[]);
});
