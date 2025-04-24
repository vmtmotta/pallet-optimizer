// app.js

// Pallet constraints
const PALLET_LENGTH    = 120,  // cm
      PALLET_WIDTH     =  80,  // cm
      MAX_HEIGHT       = 170,  // cm (all layers)
      MAX_GROSS_WEIGHT = 600,  // kg (incl 25kg pallet)
      PALLET_WEIGHT    =  25;  // kg (empty pallet)

let products = {};

// 1) Load products-detail.json
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch(`products-detail.json?cb=${Date.now()}`);
    products = await resp.json();
    console.log(`✅ Loaded ${Object.keys(products).length} SKUs`);
  } catch (err) {
    console.error('Failed to load products-detail.json', err);
    alert('Error loading product master data');
  }
});

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const input    = document.getElementById('fileInput');
  if (!customer || !input.files.length) {
    return alert('Enter customer and pick an .xlsx file');
  }

  // 2) Read the workbook
  const data = await input.files[0].arrayBuffer();
  const wb   = XLSX.read(data, { type: 'array' });
  // always use first sheet
  const sheetName = wb.SheetNames[0];
  console.log('Using sheet:', sheetName);
  const ws = wb.Sheets[sheetName];

  // 3) Convert to row arrays, skipping first 2 rows
  //    Row 0 = blank, Row 1 = header, Row 2.. = data
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 2 });
  console.log(`Read ${rows.length} data rows`, rows.slice(0,3));

  // 4) Build box‐instances
  let instances = [];
  rows.forEach((r, i) => {
    // expect: [ A:, B(blank)/BRAND, C:REF, D:PRODUCT, E:BOX USED, F:ORDER IN UNITS, ... ]
    const skuRaw  = r[1] || r[0];              // sometimes REF is in col B or C
    const sku     = skuRaw?.toString().trim();
    const name    = r[2]?.toString().trim() || sku;
    const choice  = r[3]?.toString().trim().toLowerCase(); // "box1" or "box2"
    const units   = Number(r[4]) || 0;

    console.log(`Row ${i}:`, r.slice(1,5));
    if (!sku || !products[sku]) {
      console.warn(`  ↳ skipping, no master data for SKU "${sku}"`);
      return;
    }
    if (!choice || !['box1','box2'].includes(choice)) {
      console.warn(`  ↳ skipping, bad box choice "${r[3]}"`);
      return;
    }
    if (units <= 0) {
      console.warn(`  ↳ skipping, units=${units}`);
      return;
    }

    const pd   = products[sku];
    const boxP = pd[choice];
    if (!boxP || !boxP.units) {
      console.warn(`  ↳ no box spec for ${sku}→${choice}`);
      return;
    }

    const count = Math.ceil(units / boxP.units);
    console.log(`  ↳ ${sku}: ${units} units → ${count} × ${choice} (cap ${boxP.units})`);

    for (let k = 0; k < count; k++) {
      const [L, D, H] = boxP.dimensions;
      instances.push({
        sku,
        name,
        fragility: pd.fragility.toLowerCase(),
        weight:    boxP.weight,
        dims:      { l: L, w: D, h: H },
        orientation: boxP.orientation.toLowerCase(),
        canRotate:   boxP.orientation.toLowerCase() === 'both'
      });
    }
  });

  console.log('Total box instances:', instances.length);
  if (instances.length === 0) {
    return document.getElementById('output')
      .innerHTML = `<p><em>No boxes to pack. Check your order file.</em></p>`;
  }

  // 5) Sort by fragility: strong → medium → fragile
  const orderMap = { strong:0, medium:1, fragile:2 };
  instances.sort((a,b) => orderMap[a.fragility] - orderMap[b.fragility]);

  // 6) Pack into pallets
  let remaining = instances.slice();
  const pallets  = [];
  while (remaining.length) {
    let usedH = 0, usedW = PALLET_WEIGHT;
    const pallet = { layers: [] };

    while (remaining.length) {
      const { placed, notPlaced } = packLayer(remaining);
      if (!placed.length) break;

      const layerH = Math.max(...placed.map(x=>x.box.dims.h));
      const layerW = placed.reduce((s,x)=>s + x.box.weight, 0);

      if (usedH + layerH > MAX_HEIGHT) break;
      if (usedW + layerW > MAX_GROSS_WEIGHT) break;

      pallet.layers.push({ boxes: placed, height: layerH, weight: layerW });
      usedH += layerH; usedW += layerW;
      remaining = notPlaced;
    }
    pallets.push(pallet);
  }

  // 7) Render
  renderPallets(pallets);
});

// Guillotine‐style pack one layer
function packLayer(boxes) {
  const free = [{ x:0,y:0,w:PALLET_LENGTH,h:PALLET_WIDTH }];
  const placed = [];
  let notPlaced = boxes.slice();

  boxes.forEach(b => {
    let fit = null;
    const orients = [{ l:b.dims.l, w:b.dims.w }];
    if (b.canRotate) orients.push({ l:b.dims.w, w:b.dims.l });

    for (const r of free) {
      for (const d of orients) {
        if (d.l <= r.w && d.w <= r.h) { fit={rect:r,dims:d}; break; }
      }
      if (fit) break;
    }
    if (!fit) return;

    placed.push({ box:b, x:fit.rect.x, y:fit.rect.y, dims:fit.dims });
    free.splice(free.indexOf(fit.rect), 1);
    free.push(
      { x:fit.rect.x+fit.dims.l, y:fit.rect.y,       w:fit.rect.w-fit.dims.l, h:fit.dims.w },
      { x:fit.rect.x,            y:fit.rect.y+fit.dims.w, w:fit.rect.w,            h:fit.rect.h-fit.dims.w }
    );

    notPlaced = notPlaced.filter(x=>x!==b);
  });
  return { placed, notPlaced };
}

// Render pallets & layers
function renderPallets(pallets) {
  let html='', boxTotal=0;
  pallets.forEach((p,pi) => {
    html += `<h2>PALLET ${pi+1}</h2>`;
    p.layers.forEach((ly,li) => {
      html += `<h3>Layer ${li+1} — H:${ly.height}cm Wt:${ly.weight.toFixed(1)}kg</h3>`;
      const cnt = {};
      ly.boxes.forEach(x => cnt[x.box.sku]=(cnt[x.box.sku]||0)+1);
      html += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">`
           + `<thead><tr><th>SKU</th><th>Product</th><th>#Boxes</th></tr></thead><tbody>`;
      for (let [sku,n] of Object.entries(cnt)) {
        html += `<tr><td>${sku}</td><td>${products[sku]?.name||sku}</td>`
             + `<td style="text-align:right;">${n}</td></tr>`;
        boxTotal += n;
      }
      html += `</tbody></table>`;
    });
  });
  html += `<h3>TOTAL: ${pallets.length} pallet${pallets.length>1?'s':''} | ${boxTotal} boxes</h3>`;
  document.getElementById('output').innerHTML = html;
}
