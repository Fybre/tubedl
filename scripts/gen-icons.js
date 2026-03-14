#!/usr/bin/env node
/**
 * Generates PWA PNG icons from the SVG source using canvas.
 * Run: node scripts/gen-icons.js
 * Requires: npm install canvas (dev only)
 */
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size * 0.234; // corner radius ~120/512

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#7c3aed');
  grad.addColorStop(1, '#2563eb');

  // Rounded rect
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Play triangle
  const s = size / 512;
  ctx.beginPath();
  ctx.moveTo(180 * s, 160 * s);
  ctx.lineTo(180 * s, 320 * s);
  ctx.lineTo(340 * s, 240 * s);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();

  // Download arrow stem
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 28 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(256 * s, 340 * s);
  ctx.lineTo(256 * s, 420 * s);
  ctx.stroke();

  // Download arrow head
  ctx.beginPath();
  ctx.moveTo(220 * s, 390 * s);
  ctx.lineTo(256 * s, 430 * s);
  ctx.lineTo(292 * s, 390 * s);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

for (const size of [192, 512]) {
  const buf = drawIcon(size);
  const out = path.join(ICONS_DIR, `icon-${size}.png`);
  fs.writeFileSync(out, buf);
  console.log(`Generated ${out}`);
}
console.log('Done. Icons written to public/icons/');
