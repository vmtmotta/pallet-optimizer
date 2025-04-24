// app.js

// --- Pallet constraints ---
const PALLET_LENGTH    = 120;  // cm
const PALLET_WIDTH     =  80;  // cm
const MAX_HEIGHT       = 170;  // cm (incl all layers)
const MAX_GROSS_WEIGHT = 600;  // kg (incl 25kg pallet)
const PALLET_WEIGHT    =  25;  // kg (empty)

// Load your detailed product data from JSON
let products = {};
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
    console.log(`✅ Loaded ${Object.keys(products).length} SKUs from products-detail.json`);
  } catch (err) {
    console.error('❌ Could not load products-detail.json', err);
    alert('Error loading product data; see console.');
  }
});

// Wire up “Upload & Optimize” button
document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    return alert('Please enter a customer name and select an .xlsx order file.');
  }

  // 1) Read the Excel file
  const data = await fileInput.files[0].arrayBuffer();
  const wb   = XLSX.read(data, { type: 'array' });

  // 2) Grab the “02_Order” sheet (explicitly)
  const sheetName = '02_Order';
  if (!wb.SheetNames.includes(sheetName)) {
    return alert(`Order sheet "${sheetName}" not found in workbook.`);
  }
  const ws = wb.Sheets[sheetName];

  // 3) Convert to row arrays, skipping exactly 1 header row
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1 });
  console.log(`Read ${rows.length} data rows from "${sheetName}". First 3:`, rows.slice(0,3));

  // 4) Build a flat list of box‐instances
  const instances = [];
  rows.forEach((r, idx) => {
    // Expect [ SKU, Product Name, UnitsOrdered, SelectedBox, ... ]
    const sku    = r[0]?.toString().trim();
    const name   = r[1]?.toString().trim() || sku;
    const units  = Number(r[2]) || 0;
    const choice = r[3]?.toString().trim();  // "1" or "2"

    if (!sku || !choice || units <= 0) {
      console.warn(`Skipping row ${idx} — missing SKU/choice/units:`, r.slice(0,4));
      return;
    }

    const pd = products[sku];
    if (!pd) {
      console.warn(`No master‐data for SKU "${sku}"`);
      return;
    }

    const boxKey = 'box' + choice; // yields "box1" or "box2"
    const boxP   = pd[boxKey];
    if (!boxP || !boxP.units) {
      console.warn(`No box‐option data for ${sku} → ${boxKey}`);
      return;
    }

    const count = Math.ceil(units / boxP.units);
    console.log(`Row ${idx}: ${sku}, ${units} units → ${count}×${boxKey} (${boxP.units}/box)`);

    // expand to individual box instances
    for (let i = 0; i < count; i++) {
      const [L, D, H] = boxP.dimensions;
      instances.push({
        sku,
        name,
        fragility: pd.fragility.toLowerCase(),        // "strong"/"medium"/"fragile"
        weight:    boxP.weight,                       // kg
        dims:      { l: L, w: D, h: H },              // cm
        orientation: boxP.orientation.toLowerCase(),  // "horizontal"/"both"
        canRotate:   boxP.orientation.toLowerCase() === 'both'
      });
    }
  });

  console.log(`Built ${instances.length} total box instances.`);
  if (!instances.length) {
    return document.getElementById('output').innerHTML =
      '<p><em>No boxes to pack. Check your order file.</em></p>';
  }

  // 5) Sort by fragility: strong → medium → fragile
  const fragOrder = { strong:0, medium:1, fragile:2 };
  instances.sort((a,b) => fragOrder[a.fragility] - fragOrder[b.fragility]);

  // 6) Pack into pallets
  let remaining = instances.slice();
  const pallets  = [];

  while (remaining.length) {
    let usedH = 0, usedWT = PALLET_WEIGHT;
    const pallet = { layers: [] };

    while (remaining.length) {
      const { placed, notPlaced } = packLayer(remaining);
      if (!placed.length) break;

      const layerH = Math.max(...placed.map(b => b.box.dims.h));
      const layerWT = placed.reduce((sum, b) => sum + b.box.weight, 0);

      if (usedH + layerH > MAX_HEIGHT) break;
      if (usedWT + layerWT > MAX_GROSS_WEIGHT) break;

      pallet.layers.push({ boxes: placed, height: layerH, weight: layerWT });
      usedH  += layerH;
      usedWT += layerWT;
      remaining = notPlaced;
    }

    pallets.push(pallet);
  }

  // 7) Render the results
  renderPallets(pallets);
});

// Guillotine‐style 2D pack for one layer
function packLayer(boxes) {
  const freeRects = [{ x:0, y:0, w:PALLET_LENGTH, h:PALLET_WIDTH }];
  const placed    = [];
  let notPlaced   = boxes.slice();

  boxes.forEach(box => {
    let fit = null;
    const orients = [{ l:box.dims.l, w:box.dims.w }];
    if (box.canRotate) orients.push({ l:box.dims.w, w:box.dims.l });

    for (const r of freeRects) {
      for (const d of orients) {
        if (d.l <= r.w && d.w <= r.h) { fit = { rect:r, dims:d }; break; }
      }
      if (fit) break;
    }
    if (!fit) return;

    placed.push({ box, x:fit.rect.x, y:fit.rect.y, dims:fit.dims });
    freeRects.splice(freeRects.indexOf(fit.rect), 1);
    freeRects.push(
      { x: fit.rect.x + fit.dims.l, y: fit.rect.y,         w: fit.rect.w - fit.dims.l, h: fit.dims.w },
      { x: fit.rect.x,           y: fit.rect.y + fit.dims.w, w: fit.rect.w,               h: fit.rect.h - fit.dims.w }
    );

    notPlaced = notPlaced.filter(b => b !== box);
  });

  return { placed, notPlaced };
}

// Render function
function renderPallets(pallets) {
  let html = '', totalBoxes = 0;
  pallets.forEach((p, pi) => {
    html += `<h2>PALLET ${pi+1}</h2>`;
    p.layers.forEach((layer, li) => {
      html += `<h3>Layer ${li+1}: H=${layer.height}cm, Wt=${layer.weight.toFixed(1)}kg</h3>`;
      const cnt = {};
      layer.boxes.forEach(b => cnt[b.box.sku] = (cnt[b.box.sku]||0) + 1);

      html += `
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse; margin-bottom:16px;">
          <thead><tr><th>SKU</th><th>Product</th><th># Boxes</th></tr></thead>
          <tbody>
      `;
      for (const [sku,n] of Object.entries(cnt)) {
        html += `<tr>
                   <td>${sku}</td>
                   <td>${products[sku]?.name || sku}</td>
                   <td style="text-align:right;">${n}</td>
                 </tr>`;
        totalBoxes += n;
      }
      html += `</tbody></table>`;
    });
  });
  html += `<h3>TOTAL: ${pallets.length} pallet${pallets.length>1?'s':''} | ${totalBoxes} boxes</h3>`;
  document.getElementById('output').innerHTML = html;
}
