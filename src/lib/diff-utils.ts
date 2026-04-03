export interface DiffLine {
  text: string;
  type: "same" | "added" | "removed";
}

export function computeLineDiff(
  oldText: string,
  newText: string
): { left: DiffLine[]; right: DiffLine[] } {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to get diff
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = m,
    j = n;

  const leftReverse: DiffLine[] = [];
  const rightReverse: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      leftReverse.push({ text: oldLines[i - 1], type: "same" });
      rightReverse.push({ text: newLines[j - 1], type: "same" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rightReverse.push({ text: newLines[j - 1], type: "added" });
      leftReverse.push({ text: "", type: "same" }); // padding
      j--;
    } else {
      leftReverse.push({ text: oldLines[i - 1], type: "removed" });
      rightReverse.push({ text: "", type: "same" }); // padding
      i--;
    }
  }

  left.push(...leftReverse.reverse());
  right.push(...rightReverse.reverse());

  return { left, right };
}
