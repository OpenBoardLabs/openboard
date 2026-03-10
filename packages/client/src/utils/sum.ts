export function sum(arr: number[]): number {
  return arr.reduce((acc, current) => acc + current, 0);
}
