// app.js

// --- Pallet constraints ---
const PALLET_LENGTH = 120;          // cm
const PALLET_WIDTH  =  80;          // cm
const PALLET_MAX_HEIGHT = 170;      // cm
const PALLET_MAX_GROSS = 600;       // kg (including pallet weight)
const PALLET_WEIGHT     =  25;      // kg (empty pallet)

// In-memory product details (loaded from JSON)
let products = {};

// 1) Load your detailed product data
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
  } catch (err) {
    console.error('Failed to load products-detail.json:', err);
    alert('Error loading product data.');
  }
});

// 2) Wire up the “Upload & Optimize” button
document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Please enter a customer name and select an .xlsx file.');
  }

  // 3) Read the uploaded Excel file (02_Order sheet)
  const buffer = await fileInput.files[0].arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  // Try to find the "02_Order" sheet, else fall back to first
  const orderSheetName = wb.SheetNames.includes('02_Order')
    ? '02_Order'
    : wb.SheetNames[0];
  const ws = wb.Sheets[orderSheetName];

  // Convert rows to arrays, skipping the header row
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    range: 1   // skip the first (header) line
  });

  // 4) Build a flat list of box-instances
  const instances = [];
  rows.forEach(r => {
    // Ensure row has at least 4 cols and a reference
    if (!Array.isArray(r) || !r[0]) return;

    const sku    = r[0].toString().trim();
    const name   = r[1]?.toString().trim() || sku;
    const units  = Number(r[2]) || 0;
    const choice = r[3]?.toString().trim();     // "1" or "2"
    const boxKey = 'box' + choice;               // "box1" or "box2"
    const pd     = products[sku];

    if (!pd) return;                             // unknown SKU
    const boxP = pd[boxKey];
    if (!boxP || !boxP.units) return;            // no data

    // Number of physical boxes needed
    const count = Math.ceil(units / boxP.units);

    // Push one entry per box
    for (let i = 0; i < count; i++) {
      // Dimensions [L,D,H] from your JSON
      const [L, D, H] = boxP.dimensions;
      const canBoth   = boxP.orientation.toLowerCase() === 'both';

      instances.push({
        sku,
        name,
        fragility: pd.fragility.toLowerCase(),    // "strong","medium","fragile"
        weight:    boxP.weight,                   // kg
        dims:      { l: L, w: D, h: H },          // cm
        orientation: boxP.orientation.toLowerCase(),
        canRotate:   canBoth
      });
    }
  });

  if (!instances.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No boxes to pack. Check your order file.</em></p>';
  }

  // 5) Sort by fragility: strong → medium → fragile
  const orderMap = { strong: 0, medium: 1, fragile: 2 };
  instances.sort((a, b) => orderMap[a.fragility] - orderMap[b.fragility]);

  // 6) Pack instances into pallets
  let remaining = instances.slice();
  const pallets  = [];

  while (remaining.length) {
    let usedHeight = 0;
    let usedWeight = PALLET_WEIGHT;
    const pallet   = { layers: [] };

    // Fill layers until we hit height or weight limits
    while (remaining.length) {
      const { placed, notPlaced } = packLayer(remaining);

      if (!placed.length) break;  // nothing fit → done with this pallet

      const layerHeight = Math.max(...placed.map(b => b.box.dims.h));
      const layerWeight = placed.reduce((sum, b) => sum + b.box.weight, 0);

      // Check max height
      if (usedHeight + layerHeight > PALLET_MAX_HEIGHT) break;
      // Check max weight
      if (usedWeight + layerWeight > PALLET_MAX_GROSS) break;

      // Commit this layer
      pallet.layers.push({ boxes: placed, height: layerHeight, weight: layerWeight });
      usedHeight += layerHeight;
      usedWeight += layerWeight;
      remaining = notPlaced;
    }

    pallets.push(pallet);
  }

  // 7) Render the results
  renderPallets(pallets);
});

// Guillotine‐style 2D pack for one layer
function packLayer(boxes) {
  // Free rectangles in the pallet footprint
  const freeRects = [{ x: 0, y: 0, w: PALLET_LENGTH, h: PALLET_WIDTH }];
  const placed    = [];
  let notPlaced   = boxes.slice();

  // Try each box in order
  boxes.forEach(box => {
    let fit = null;
    const dimsList = [{ l: box.dims.l, w: box.dims.w }];
    if (box.canRotate) dimsList.push({ l: box.dims.w, w: box.dims.l });

    // Find a free rect it fits
    for (const rect of freeRects) {
      for (const d of dimsList) {
        if (d.l <= rect.w && d.w <= rect.h) {
          fit = { rect, dims: d };
          break;
        }
      }
      if (fit) break;
    }
    if (!fit) return;  // this box doesn't fit in any free rect

    // Place the box
    placed.push({ box, x: fit.rect.x, y: fit.rect.y, dims: fit.dims });

    // Remove that free rect
    freeRects.splice(freeRects.indexOf(fit.rect), 1);

    // Split the free rect into two
    freeRects.push(
      { x: fit.rect.x + fit.dims.l, y: fit.rect.y,       w: fit.rect.w - fit.dims.l, h: fit.dims.w },
      { x: fit.rect.x,           y: fit.rect.y + fit.dims.w, w: fit.rect.w,               h: fit.rect.h - fit.dims.w }
    );

    // Remove this box from notPlaced
    notPlaced = notPlaced.filter(b => b !== box);
  });

  return { placed, notPlaced };
}

// Render pallets & layers as HTML tables
function renderPallets(pallets) {
  let html = '';
  let palletCount = pallets.length;
  let totalBoxes = 0;

  pallets.forEach((pallet, pi) => {
    html += `<h2>PALLET ${pi + 1}</h2>`;

    pallet.layers.forEach((layer, li) => {
      html += `<h3>Layer ${li + 1} — Height: ${layer.height}cm, Wt: ${layer.weight.toFixed(1)}kg</h3>`;
      // Count boxes by SKU
      const cnt = {};
      layer.boxes.forEach(b => cnt[b.box.sku] = (cnt[b.box.sku] || 0) + 1);

      html += `
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse; margin-bottom:16px;">
          <thead>
            <tr><th>SKU</th><th>Product</th><th>#Boxes</th></tr>
          </thead>
          <tbody>
      `;
      for (const [sku, num] of Object.entries(cnt)) {
        html += `
          <tr>
            <td>${sku}</td>
            <td>${products[sku]?.name || sku}</td>
            <td style="text-align:right;">${num}</td>
          </tr>
        `;
        totalBoxes += num;
      }
      html += `</tbody></table>`;
    });
  });

  html += `<h3>TOTAL: ${palletCount} pallet${palletCount>1?'s':''} | ${totalBoxes} boxes</h3>`;
  document.getElementById('output').innerHTML = html;
}
