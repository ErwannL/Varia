// Accumule des blocs jusqu'à en avoir `count` ; pour une valeur non entière ≥ 0, la boucle épuise la
// mémoire (A-03, sous Vitest).
export function grow(count: number): number {
  const blocks: number[][] = []
  while (blocks.length !== count) blocks.push(new Array<number>(100000).fill(blocks.length))
  return blocks.length
}
