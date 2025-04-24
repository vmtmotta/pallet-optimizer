// app.js

// --- Pallet constraints ---
const PALLET_LENGTH = 120;         // cm
const PALLET_WIDTH  =  80;         // cm
const MAX_HEIGHT    = 170;         // cm (incl. all layers)
const MAX_GROSS_WT  = 600;         // kg (incl. 25kg pallet)
const PALLET_WT     =  25;         // kg

let products = {};

// 1) Load detailed product data
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
    console.log('✅ Loaded products-detail.json');
  } catch (e) {
    console.error('❌ Could not load products-detail.json', e);
    alert('Error loading product data; check console.');
  }
});

// 2) Upload & Optimize
document.getElementById('go').addEventListener('click', async () => {
  const cust = document.getElementById('customer').value.trim();
  const inp  = document.getElementById('fileInput');
  if (!cust || !inp.files.length) {
    return alert('Enter a customer name and select an .xlsx order file.');
  }

  // 3) Read Excel
  const buf = await inp.files[0].arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array' });

  console.log('Available sheets:', wb.SheetNames);
  const sheetName = wb.SheetNames[0];
  console.log('Using sheet:', sheetName);

  const ws = wb.Sheets[sheetName];
  // Skip 3 header rows
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });
  console.log('First 5 data rows:', rows.slice(0, 5));

  // 4) Build box‐instances
  let instances = [];
  rows.forEach(r => {
    // Expect at least 6 columns: [A, B, C=Ref, D=Prod, E=Box# (1/2), F=Units, ...]
    const sku    = r[2]?.toString().trim();
    const name   = r[3]?.toString().trim() || sku;
    const choice = r[4]?.toString().trim();
    const units  = Number(r[5]) || 0;
    if (!sku || !choice || units <= 0) return;

    const pd     = products[sku];
    if (!pd) {
      console.warn(`No product data for SKU ${sku}`);
      return;
    }

    const key    = 'box' + choice;       // "box1" or "box2"
    const boxP   = pd[key];
    if (!boxP || !boxP.units) {
      console.warn(`Missing box data for ${sku} → ${key}`);
      return;
    }

    // How many physical boxes?
    const count = Math.ceil(units / boxP.units);
    for (let i = 0; i < count; i++) {
      const [L, D, H] = boxP.dimensions;
      const canBoth   = boxP.orientation.toLowerCase() === 'both';
      instances.push({
        sku,
        name,
        fragility: pd.fragility.toLowerCase(),
        weight:    boxP.weight,
        dims:      { l: L, w: D, h: H },
        orientation: boxP.orientation.toLowerCase(),
        canRotate:   canBoth
      });
    }
  });

  if (!instances.length) {
    document.getElementById('output').innerHTML =
      '<p><em>No boxes to pack. Check your order file.</em></p>';
    return;
  }

  console.log(`Built ${instances.length} box instances`);

  // 5) Sort by fragility: strong → medium → fragile
  const fragOrder = { strong: 0, medium: 1, fragile: 2 };
  instances.sort((a, b) => fragOrder[a.fragility] - fragOrder[b.fragility]);

  // 6) Pack into pallets
  let remaining = instances.slice();
  const pallets  = [];

  while (remaining.length) {
    let usedH = 0, usedW = PALLET_WT;
    const pallet = { layers: [] };

    // Fill layers
    while (remaining.length) {
      const { placed, notPlaced } = packLayer(remaining);
      if (!placed.length) break;

      const layerH = Math.max(...placed.map(b => b.box.dims.h));
      const layerW = placed.reduce((s, b) => s + b.box.weight, 0);

      if (usedH + layerH > MAX_HEIGHT) break;
      if (usedW + layerW > MAX_GROSS_WT) break;

      pallet.layers.push({ boxes: placed, height: layerH, weight: layerW });
      usedH += layerH;
      usedW += layerW;
      remaining = notPlaced;
    }

    pallets.push(pallet);
  }

  // 7) Render results
  render(pallets);
});

// Guillotine‐style pack for one layer
function packLayer(boxes) {
  const freeR = [{ x: 0, y: 0, w: PALLET_LENGTH, h: PALLET_WIDTH }];
  const placed = [];
  let notPlaced = boxes.slice();

  boxes.forEach(box => {
    let fit = null;
    const orientations = [{ l: box.dims.l, w: box.dims.w }];
    if (box.canRotate) orientations.push({ l: box.dims.w, w: box.dims.l });

    for (const r of freeR) {
      for (const d of orientations) {
        if (d.l <= r.w && d.w <= r.h) {
          fit = { rect: r, dims: d };
          break;
        }
      }
      if (fit) break;
    }
    if (!fit) return;

    const { rect, dims } = fit;
    placed.push({ box, x: rect.x, y: rect.y, dims });

    freeR.splice(freeR.indexOf(rect), 1);
    freeR.push(
      { x: rect.x + dims.l, y: rect.y,       w: rect.w - dims.l, h: dims.w },
      { x: rect.x,       y: rect.y + dims.w, w: rect.w,           h: rect.h - dims.w }
    );

    notPlaced = notPlaced.filter(b => b !== box);
  });

  return { placed, notPlaced };
}

// Render pallets & layers
function render(pallets) {
  let html = '', totalBoxes = 0;
  pallets.forEach((p, pi) => {
    html += `<h2>PALLET ${pi + 1}</h2>`;
    p.layers.forEach((ly, li) => {
      html += `<h3>Layer ${li + 1} — H:${ly.height}cm, Wt:${ly.weight.toFixed(1)}kg</h3>`;
      const cnt = {};
      ly.boxes.forEach(b => cnt[b.box.sku] = (cnt[b.box.sku]||0) + 1);

      html += `
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
          <thead><tr><th>SKU</th><th>Product</th><th>#Boxes</th></tr></thead>
          <tbody>
      `;
      Object.entries(cnt).forEach(([sku, n]) => {
        html += `
          <tr>
            <td>${sku}</td>
            <td>${products[sku]?.name || sku}</td>
            <td style="text-align:right;">${n}</td>
          </tr>
        `;
        totalBoxes += n;
      });
      html += `</tbody></table>`;
    });
  });

  html += `<h3>TOTAL: ${pallets.length} pallet${pallets.length>1?'s':''} | ${totalBoxes} boxes</h3>`;
  document.getElementById('output').innerHTML = html;
}
