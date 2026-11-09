/** Atlas: left cell = start (play triangle), right cell = stop (rounded square). */
export function drawIconAtlas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 128);
  for (const cx of [64, 192]) {
    ctx.fillStyle = "rgba(12,14,24,0.8)";
    ctx.beginPath();
    ctx.arc(cx, 64, 58, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  // play triangle, ~58px tall overall (incl. rounded stroke), optically centred
  const h = 50;
  const w = h * 0.87;
  const ox = 64 + 5 - w / 2;
  ctx.beginPath();
  ctx.moveTo(ox, 64 - h / 2);
  ctx.lineTo(ox + w, 64);
  ctx.lineTo(ox, 64 + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // rounded square, ~46px
  const q = 38;
  ctx.beginPath();
  ctx.rect(192 - q / 2, 64 - q / 2, q, q);
  ctx.fill();
  ctx.stroke();
  return canvas;
}
