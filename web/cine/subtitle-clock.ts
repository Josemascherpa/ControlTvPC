export interface TimedCue { readonly startTime: number; readonly endTime: number }
export interface CueIndex<T extends TimedCue> { readonly cues: readonly T[]; readonly maxEnd: readonly number[] }
export function indexCues<T extends TimedCue>(cues: readonly T[]): CueIndex<T> {
  const sorted = [...cues].sort((a,b) => a.startTime-b.startTime);
  let max = -Infinity;
  return { cues: sorted, maxEnd: sorted.map(cue => (max = Math.max(max,cue.endTime))) };
}
/** delay positivo = mostrar más tarde. scale corrige diferencias de ritmo entre versiones. */
export function subtitleTime(videoTime: number, delay: number, scale = 1): number {
  return (videoTime-delay)/scale;
}
export function activeCuesAt<T extends TimedCue>(index: CueIndex<T>, now: number): readonly T[] {
  let low=0,high=index.cues.length;
  while(low<high) { const middle=(low+high)>>>1; if((index.cues[middle]?.startTime ?? Infinity)<=now) low=middle+1; else high=middle; }
  const active:T[]=[];
  for(let i=low-1;i>=0;i--) {
    if((index.maxEnd[i] ?? -Infinity)<=now) break;
    const cue=index.cues[i];
    if(cue && cue.startTime<=now && cue.endTime>now) active.push(cue);
  }
  return active.reverse();
}
