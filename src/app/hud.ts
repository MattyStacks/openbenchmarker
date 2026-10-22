/** Frame-time graph: up to 240 points (graphPoints windows of ~25 ms), auto-scaled, with a 60 FPS line. */
export function drawGraph(graph: HTMLCanvasElement, g2d: CanvasRenderingContext2D, times: number[]): void {
  const W = graph.width, H = graph.height;
  g2d.clearRect(0, 0, W, H);
  const n = Math.min(times.length, 240);
  let max = 25;
  for (let i = times.length - n; i < times.length; i++) max = Math.max(max, times[i] * 1.15);
  const y60 = H - (16.667 / max) * H;
  g2d.strokeStyle = "rgba(255,62,219,0.55)";
  g2d.setLineDash([4, 4]);
  g2d.beginPath();
  g2d.moveTo(0, y60);
  g2d.lineTo(W, y60);
  g2d.stroke();
  g2d.setLineDash([]);
  g2d.fillStyle = "rgba(240,236,255,0.75)";
  g2d.font = "10px ui-monospace, Menlo, Consolas, monospace";
  g2d.fillText(`60 FPS · max ${max.toFixed(0)} ms`, 4, Math.max(10, y60 - 3));
  g2d.strokeStyle = "#2ee9ff";
  g2d.lineWidth = 1.5;
  g2d.shadowColor = "#2ee9ff";
  g2d.shadowBlur = 4;
  g2d.beginPath();
  for (let i = 0; i < n; i++) {
    const t = times[times.length - n + i];
    const x = (i / 239) * W, y = H - (t / max) * H;
    if (i) g2d.lineTo(x, y);
    else g2d.moveTo(x, y);
  }
  g2d.stroke();
  g2d.shadowBlur = 0;
}
